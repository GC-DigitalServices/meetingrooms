import type { BookingSource } from "@prisma/client";
import { db } from "@/lib/db/client";
import { getConfig } from "@/lib/config";
import { graphClient } from "@/lib/graph/client";
import type { GraphCalendarViewResponse, GraphEvent } from "@/lib/graph/types";
import { isOverlongRoomBooking } from "@/lib/booking/duration";
import { logger } from "@/lib/logger";

// Extended property ID used to store the real organiser's UPN on Graph events.
// Phase 3 writes this property; phase 2 reads it and falls back gracefully.
export const ORGANISER_UPN_PROP_ID =
  "String {00000000-0000-0000-0000-000000000001} Name OrganiserUpn";

// Extended property ID recording which of our surfaces wrote the event.
// Written by `createGraphEvent`; read back by `resolveBookingSource` below.
// (Declared here rather than in events.ts so both readers and the writer share
// one definition without events.ts and sync.ts importing each other.)
export const SOURCE_PROP_ID =
  "String {00000000-0000-0000-0000-000000000002} Name Source";

// The $select/$expand shared by every event read, so the two call sites (this
// resync and the webhook handler) cannot drift apart on which fields they ask
// for. `type` distinguishes a series master from a single event or occurrence.
export const EVENT_QUERY_FIELDS =
  `$select=id,iCalUId,subject,start,end,isAllDay,type,organizer,attendees,singleValueExtendedProperties` +
  `&$expand=singleValueExtendedProperties($filter=id eq '${ORGANISER_UPN_PROP_ID}' or id eq '${SOURCE_PROP_ID}')`;

/**
 * Which system wrote this event.
 *
 * Our own writes carry the Source extended property. An event without one was
 * written directly to the room mailbox by something else — in practice
 * Salamander (invariant 2), which is the only other writer. Everything synced
 * used to be stamped PORTAL, which made "which bookings did we not write?"
 * unanswerable; that question is what spotting bad MIS data needs.
 */
export function resolveBookingSource(event: GraphEvent): BookingSource {
  const value = event.singleValueExtendedProperties?.find(
    (p) => p.id === SOURCE_PROP_ID,
  )?.value;
  return value === "PORTAL" || value === "IPAD_QR" ? value : "EXCHANGE";
}

/**
 * Logs a booking longer than the write path's own cap. See
 * `isOverlongRoomBooking` — reported, never filtered.
 */
export function reportIfOverlong(
  event: GraphEvent,
  roomKind: string,
  roomId: string,
  startUtc: Date,
  endUtc: Date,
): void {
  if (!isOverlongRoomBooking(roomKind, startUtc, endUtc)) return;
  logger.warn(
    {
      roomId,
      graphICalUid: event.iCalUId,
      subject: event.subject,
      start: startUtc.toISOString(),
      end: endUtc.toISOString(),
      hours: Math.round((endUtc.getTime() - startUtc.getTime()) / 3_600_000),
    },
    "graph: overlong_room_booking",
  );
}

// ---------------------------------------------------------------------------
// Composite room resolution
// ---------------------------------------------------------------------------
// Derives the logical roomId (STANDARD, SECTION, or COMPOSITE) for an event
// by inspecting the event's resource attendees against our room list.
// - One section invited  → that section's id
// - Multiple sections from the same composite → composite's id
// - No match (shouldn't happen) → fallback roomId from the subscription

export function resolveLogicalRoomId(
  resourceAttendeeUpns: string[],
  mailboxToRoomId: Map<string, string>,
  sectionToParentId: Map<string, string>,
  fallbackRoomId: string,
): string {
  const upns = resourceAttendeeUpns.map((u) => u.toLowerCase());
  const roomIds = upns
    .map((u) => mailboxToRoomId.get(u))
    .filter((id): id is string => id !== undefined);

  if (roomIds.length === 0) return fallbackRoomId;
  if (roomIds.length === 1) return roomIds[0];

  const parentIds = new Set(roomIds.map((id) => sectionToParentId.get(id) ?? id));
  return parentIds.size === 1 ? [...parentIds][0] : fallbackRoomId;
}

// ---------------------------------------------------------------------------
// Recurring series
// ---------------------------------------------------------------------------

/**
 * The occurrences of a recurring series that fall inside the sync window.
 *
 * Graph fires change notifications for a series against the series master,
 * whose start and end are those of the *first* occurrence only. Mirroring the
 * master would leave every other occurrence — a whole year of timetabled
 * lessons, for a Salamander series — missing from the cache until the nightly
 * resync. Each occurrence returned here carries its own id and its own
 * iCalUId, so each mirrors as an independent booking row.
 */
export async function fetchSeriesOccurrences(
  mailboxUpn: string,
  seriesMasterId: string,
): Promise<GraphEvent[]> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + getConfig().SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const occurrences: GraphEvent[] = [];
  let url =
    `/users/${encodeURIComponent(mailboxUpn)}/events/${encodeURIComponent(seriesMasterId)}/instances` +
    `?startDateTime=${now.toISOString()}` +
    `&endDateTime=${windowEnd.toISOString()}` +
    `&$top=250` +
    `&${EVENT_QUERY_FIELDS}`;

  while (url) {
    const page = await graphClient.getCalendar<GraphCalendarViewResponse>(url);
    occurrences.push(...page.value);
    url = page["@odata.nextLink"] ?? "";
  }

  return occurrences;
}

// ---------------------------------------------------------------------------
// Sync a single mailbox
// ---------------------------------------------------------------------------

export async function syncMailbox(
  mailboxUpn: string,
  fallbackRoomId: string,
  roomKind: string,
  mailboxToRoomId: Map<string, string>,
  sectionToParentId: Map<string, string>,
): Promise<{ added: number; updated: number; removed: number }> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + getConfig().SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Fetch all events in the window, paginating through nextLinks.
  const events: GraphEvent[] = [];
  let url =
    `/users/${encodeURIComponent(mailboxUpn)}/calendarView` +
    `?startDateTime=${now.toISOString()}` +
    `&endDateTime=${windowEnd.toISOString()}` +
    `&${EVENT_QUERY_FIELDS}`;

  while (url) {
    const page = await graphClient.getCalendar<GraphCalendarViewResponse>(url);
    events.push(...page.value);
    url = page["@odata.nextLink"] ?? "";
  }

  // Current DB state keyed by iCalUId for dedup.
  //
  // Scoped to the same window calendarView returned (overlap, not containment —
  // calendarView includes events straddling either edge). Anything outside it
  // was never a candidate for this pass, so it must not be treated as stale
  // below: a booking beyond windowEnd (an exam timetabled next term) or already
  // in the past is absent from `events` simply because we did not ask for it,
  // not because it was cancelled in Exchange.
  const dbRows = await db.booking.findMany({
    where: {
      roomId: fallbackRoomId,
      startUtc: { lt: windowEnd },
      endUtc: { gt: now },
    },
    select: { id: true, graphICalUid: true },
  });
  const dbByICalUid = new Map(dbRows.map((r) => [r.graphICalUid, r.id]));

  let added = 0;
  let updated = 0;
  const seenICalUids = new Set<string>();

  for (const event of events) {
    seenICalUids.add(event.iCalUId);

    const resourceUpns = event.attendees
      .filter((a) => a.type === "resource")
      .map((a) => a.emailAddress.address);

    const logicalRoomId = resolveLogicalRoomId(
      resourceUpns,
      mailboxToRoomId,
      sectionToParentId,
      fallbackRoomId,
    );

    const organiserProp = event.singleValueExtendedProperties?.find(
      (p) => p.id === ORGANISER_UPN_PROP_ID,
    );
    const organiserUpn = organiserProp?.value ?? event.organizer.emailAddress.address;

    // Resolve from attendees: event.organizer is the room mailbox (we write under app creds).
    const organiserAttendee = event.attendees.find(
      (a) => a.emailAddress.address.toLowerCase() === organiserUpn.toLowerCase(),
    );
    const organiserName = organiserAttendee?.emailAddress.name ?? event.organizer.emailAddress.name;

    const startUtc = new Date(event.start.dateTime + "Z");
    const endUtc = new Date(event.end.dateTime + "Z");

    reportIfOverlong(event, roomKind, logicalRoomId, startUtc, endUtc);

    // `source` is part of `data`, so a resync corrects rows mirrored before the
    // Source extended property was read back — including the ones mislabelled
    // PORTAL. The property is authoritative for our own writes, so this cannot
    // lose a booking's provenance.
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

    const existingId = dbByICalUid.get(event.iCalUId);
    if (existingId) {
      await db.booking.update({ where: { id: existingId }, data });
      updated++;
    } else {
      // Also check against the whole table in case this is a section of a
      // composite that was already synced from another section's mailbox.
      const crossRoom = await db.booking.findFirst({
        where: { graphICalUid: event.iCalUId },
        select: { id: true },
      });
      if (crossRoom) {
        await db.booking.update({ where: { id: crossRoom.id }, data });
        updated++;
      } else {
        await db.booking.create({ data });
        added++;
      }
    }
  }

  // Delete bookings no longer in Exchange. Only in-window rows are considered
  // (see the dbRows query above).
  const staleUids = [...dbByICalUid.keys()].filter((uid) => !seenICalUids.has(uid));
  if (staleUids.length) {
    await db.booking.deleteMany({ where: { graphICalUid: { in: staleUids } } });
  }

  return { added, updated, removed: staleUids.length };
}

// ---------------------------------------------------------------------------
// Full resync — all room mailboxes
// ---------------------------------------------------------------------------

export async function fullResync(): Promise<void> {
  logger.info("graph: full resync starting");

  const rooms = await db.room.findMany({
    where: { kind: { not: "COMPOSITE" }, mailboxUpn: { not: null } },
  });

  const mailboxToRoomId = new Map<string, string>();
  const sectionToParentId = new Map<string, string>();
  for (const room of rooms) {
    if (room.mailboxUpn) mailboxToRoomId.set(room.mailboxUpn.toLowerCase(), room.id);
    if (room.parentRoomId) sectionToParentId.set(room.id, room.parentRoomId);
  }

  let totalAdded = 0;
  let totalUpdated = 0;
  let totalRemoved = 0;
  let errors = 0;

  for (const room of rooms) {
    if (!room.mailboxUpn) continue;
    try {
      const stats = await syncMailbox(
        room.mailboxUpn,
        room.id,
        room.kind,
        mailboxToRoomId,
        sectionToParentId,
      );
      totalAdded += stats.added;
      totalUpdated += stats.updated;
      totalRemoved += stats.removed;
    } catch (err) {
      errors++;
      logger.error({ roomId: room.id, err }, "graph: resync failed for room");
    }
  }

  logger.info(
    {
      rooms: rooms.length,
      added: totalAdded,
      updated: totalUpdated,
      removed: totalRemoved,
      errors,
    },
    "graph: resync_completed",
  );
}
