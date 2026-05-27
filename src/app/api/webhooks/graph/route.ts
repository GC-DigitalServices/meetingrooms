import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { graphClient } from "@/lib/graph/client";
import type { GraphEvent, GraphNotificationPayload } from "@/lib/graph/types";
import { ORGANISER_UPN_PROP_ID } from "@/lib/graph/sync";
import { logger } from "@/lib/logger";

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

  let payload: GraphNotificationPayload;
  try {
    payload = (await req.json()) as GraphNotificationPayload;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
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
    if (sub.clientState !== n.clientState) {
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
  await db.booking.deleteMany({ where: { graphEventId } });
}

async function handleCreatedOrUpdated(
  graphEventId: string,
  mailboxUpn: string,
  fallbackRoomId: string,
  mailboxToRoomId: Map<string, string>,
  sectionToParentId: Map<string, string>
): Promise<void> {
  const event = await graphClient.getCalendar<GraphEvent>(
    `/users/${encodeURIComponent(mailboxUpn)}/events/${graphEventId}` +
      `?$select=id,iCalUId,subject,start,end,isAllDay,organizer,attendees,singleValueExtendedProperties` +
      `&$expand=singleValueExtendedProperties($filter=id eq '${ORGANISER_UPN_PROP_ID}')`
  );

  // Resolve logical room from resource attendees.
  const resourceUpns = event.attendees
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

  const data = {
    graphEventId: event.id,
    graphICalUid: event.iCalUId,
    roomId: logicalRoomId,
    organiserUpn,
    organiserName: event.organizer.emailAddress.name,
    subject: event.subject,
    startUtc: new Date(event.start.dateTime + "Z"),
    endUtc: new Date(event.end.dateTime + "Z"),
    isAllDay: event.isAllDay,
    source: "PORTAL" as const,
    lastSyncedAt: new Date(),
  };

  // Dedup on iCalUId to handle composite-room bookings arriving as N notifications.
  const existing = await db.booking.findFirst({
    where: { graphICalUid: event.iCalUId },
    select: { id: true },
  });
  if (existing) {
    await db.booking.update({ where: { id: existing.id }, data });
  } else {
    await db.booking.create({ data });
  }
}
