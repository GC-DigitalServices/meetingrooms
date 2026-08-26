import crypto from "crypto";
import { db } from "@/lib/db/client";
import { graphClient } from "@/lib/graph/client";
import type { GraphEvent, GraphNotificationPayload } from "@/lib/graph/types";
import {
  ORGANISER_UPN_PROP_ID,
  EVENT_QUERY_FIELDS,
  fetchSeriesOccurrences,
  resolveBookingSource,
  reportIfOverlong,
} from "@/lib/graph/sync";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/realtime/rateLimit";
import { apiError } from "@/lib/api/errors";
import {
  publishBookingCreated,
  publishBookingUpdated,
  publishBookingDeleted,
} from "@/lib/realtime/publish";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// POST /api/webhooks/graph
// Handles both the Graph validation handshake and change notifications.
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  // Validation handshake: Graph sends ?validationToken=... and expects it echoed back.
  const { searchParams } = new URL(req.url);
  const validationToken = searchParams.get("validationToken");
  if (validationToken) {
    logger.debug("webhook: validation handshake");
    return new Response(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // Rate limit — protects against webhook URL abuse. The per-IP key uses the
  // client-supplied X-Forwarded-For (spoofable), so a global backstop caps a
  // spoofed-IP flood regardless. Graph sends from Microsoft IP ranges; these
  // limits give ample headroom for legitimate notification volume.
  const ip =
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const ipRl = await checkRateLimit(`rl:webhook:ip:${ip}`, 500, 60_000);
  const globalRl = await checkRateLimit("rl:webhook:global", 5_000, 60_000);
  if (!ipRl.allowed || !globalRl.allowed) {
    return new Response(null, {
      status: 429,
      headers: { "Retry-After": String(Math.max(ipRl.retryAfterSecs, globalRl.retryAfterSecs)) },
    });
  }

  let payload: GraphNotificationPayload;
  try {
    payload = (await req.json()) as GraphNotificationPayload;
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid request body");
  }

  // Acknowledge immediately — Graph requires a response within 10 seconds.
  // Process in background so we don't hold the connection open.
  processNotifications(payload).catch((err) => {
    logger.error({ err }, "webhook: background processing failed");
  });

  return new Response(null, { status: 202 });
}

// ---------------------------------------------------------------------------
// Notification processing
// ---------------------------------------------------------------------------

/** Constant-time string comparison that tolerates unequal lengths and null/undefined. */
function timingSafeStrEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

async function processNotifications(payload: GraphNotificationPayload): Promise<void> {
  // Pre-load room lookup maps once for all notifications in this batch.
  const rooms = await db.room.findMany({
    where: { kind: { not: "COMPOSITE" }, mailboxUpn: { not: null } },
  });
  const mailboxToRoomId = new Map(
    rooms.map((r) => [r.mailboxUpn!.toLowerCase(), r.id])
  );
  const sectionToParentId = new Map(
    rooms.filter((r) => r.parentRoomId).map((r) => [r.id, r.parentRoomId!])
  );

  for (const n of payload.value) {
    logger.info(
      { subscriptionId: n.subscriptionId, changeType: n.changeType },
      "webhook: webhook_received"
    );

    const sub = await db.graphSubscription.findUnique({
      where: { id: n.subscriptionId },
    });

    if (!sub) {
      logger.warn({ subscriptionId: n.subscriptionId }, "webhook: unknown subscription, ignoring");
      continue;
    }
    if (!timingSafeStrEqual(sub.clientState, n.clientState)) {
      logger.warn({ subscriptionId: n.subscriptionId }, "webhook: clientState mismatch, ignoring");
      continue;
    }

    logger.info({ subscriptionId: n.subscriptionId }, "webhook: webhook_validated");

    try {
      if (n.changeType === "deleted") {
        await handleDeleted(n.resourceData.id);
      } else {
        const room = rooms.find((r) => r.id === sub.roomId);
        if (room?.mailboxUpn) {
          await handleCreatedOrUpdated(
            n.resourceData.id,
            room.mailboxUpn,
            sub.roomId,
            room.kind,
            mailboxToRoomId,
            sectionToParentId
          );
        }
      }
      logger.info({ subscriptionId: n.subscriptionId }, "webhook: webhook_processed");
    } catch (err) {
      logger.error({ subscriptionId: n.subscriptionId, err }, "webhook: failed to process notification");
    }
  }
}

async function handleDeleted(graphEventId: string): Promise<void> {
  // Load before deleting so we have roomId and parentRoomId for the broadcast.
  const existing = await db.booking.findFirst({
    where: { graphEventId },
    select: { id: true, roomId: true, room: { select: { parentRoomId: true } } },
  });
  await db.booking.deleteMany({ where: { graphEventId } });
  if (existing) {
    publishBookingDeleted(existing.roomId, existing.id, existing.room.parentRoomId).catch(
      (err) => logger.warn({ err, graphEventId }, "ws: booking.deleted broadcast failed")
    );
  }
}

async function handleCreatedOrUpdated(
  graphEventId: string,
  mailboxUpn: string,
  fallbackRoomId: string,
  roomKind: string,
  mailboxToRoomId: Map<string, string>,
  sectionToParentId: Map<string, string>
): Promise<void> {
  const event = await graphClient.getCalendar<GraphEvent>(
    `/users/${encodeURIComponent(mailboxUpn)}/events/${graphEventId}?${EVENT_QUERY_FIELDS}`
  );

  // A change to a recurring series notifies us about the series master, whose
  // start/end are the first occurrence's. Mirroring that row would leave the
  // rest of the series — a full year of timetabled lessons, for a Salamander
  // booking — missing from the cache until the nightly resync, so the room
  // would read as free for every lesson but the first. Mirror the occurrences
  // instead; each has its own id and iCalUId. The master itself is never
  // mirrored, so no phantom row is created for it.
  if (event.type === "seriesMaster") {
    const occurrences = await fetchSeriesOccurrences(mailboxUpn, event.id);
    logger.info(
      { graphEventId, occurrences: occurrences.length },
      "webhook: series_master_expanded"
    );
    for (const occurrence of occurrences) {
      await mirrorEvent(occurrence, fallbackRoomId, roomKind, mailboxToRoomId, sectionToParentId);
    }
    return;
  }

  await mirrorEvent(event, fallbackRoomId, roomKind, mailboxToRoomId, sectionToParentId);
}

/**
 * Upserts one Graph event into the booking cache and broadcasts the change.
 *
 * Occurrences fetched from a series master may come back without an attendees
 * collection; the logical room then falls back to the subscription's own room,
 * which is what a single-room timetable series wants anyway.
 */
async function mirrorEvent(
  event: GraphEvent,
  fallbackRoomId: string,
  roomKind: string,
  mailboxToRoomId: Map<string, string>,
  sectionToParentId: Map<string, string>
): Promise<void> {
  // Resolve logical room from resource attendees.
  const resourceUpns = (event.attendees ?? [])
    .filter((a) => a.type === "resource")
    .map((a) => a.emailAddress.address);

  const involvedRoomIds = resourceUpns
    .map((u) => mailboxToRoomId.get(u.toLowerCase()))
    .filter((id): id is string => id !== undefined);

  let logicalRoomId = fallbackRoomId;
  if (involvedRoomIds.length > 1) {
    const parentIds = new Set(involvedRoomIds.map((id) => sectionToParentId.get(id) ?? id));
    if (parentIds.size === 1) logicalRoomId = [...parentIds][0];
  } else if (involvedRoomIds.length === 1) {
    logicalRoomId = involvedRoomIds[0];
  }

  const organiserProp = event.singleValueExtendedProperties?.find(
    (p) => p.id === ORGANISER_UPN_PROP_ID
  );
  const organiserUpn = organiserProp?.value ?? event.organizer.emailAddress.address;

  // The Graph event's organizer field is the room mailbox (we write under app credentials),
  // not the real person. Resolve the real organiser name from the attendees list instead.
  const organiserAttendee = (event.attendees ?? []).find(
    (a) => a.emailAddress.address.toLowerCase() === organiserUpn.toLowerCase()
  );
  const organiserName = organiserAttendee?.emailAddress.name ?? event.organizer.emailAddress.name;

  const startUtc = new Date(event.start.dateTime + "Z");
  const endUtc = new Date(event.end.dateTime + "Z");

  reportIfOverlong(event, roomKind, logicalRoomId, startUtc, endUtc);

  // `source` comes from the Source extended property, which our own writes carry
  // and Salamander's do not — so it is safe on the update path too, and a resync
  // corrects rows mirrored before we read the property back.
  const data = {
    graphEventId: event.id,
    graphICalUid: event.iCalUId,
    roomId: logicalRoomId,
    organiserUpn,
    organiserName,
    subject: event.subject,
    startUtc,
    endUtc,
    isAllDay: event.isAllDay,
    source: resolveBookingSource(event),
    lastSyncedAt: new Date(),
  };

  // parentId for broadcast fan-out: section bookings go to both their channel and parent's.
  const parentId = sectionToParentId.get(logicalRoomId) ?? null;

  // Dedup on iCalUId to handle composite-room bookings arriving as N
  // notifications (and concurrent redeliveries of the same one). graphICalUid is
  // UNIQUE, so the upsert is atomic — two racing handlers cannot both insert.
  // The findFirst below only decides which broadcast to emit; correctness no
  // longer depends on it.
  const existing = await db.booking.findFirst({
    where: { graphICalUid: event.iCalUId },
    select: { id: true },
  });
  const row = await db.booking.upsert({
    where: { graphICalUid: event.iCalUId },
    create: data,
    update: data,
  });
  if (existing) {
    publishBookingUpdated(row, parentId).catch((err) =>
      logger.warn({ err, bookingId: row.id }, "ws: booking.updated broadcast failed")
    );
  } else {
    publishBookingCreated(row, parentId).catch((err) =>
      logger.warn({ err, graphEventId: event.id }, "ws: booking.created broadcast failed")
    );
  }
}
