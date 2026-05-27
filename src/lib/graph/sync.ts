import { db } from "@/lib/db/client";
import { graphClient } from "@/lib/graph/client";
import type { GraphCalendarViewResponse, GraphEvent } from "@/lib/graph/types";
import { logger } from "@/lib/logger";

// Extended property ID used to store the real organiser's UPN on Graph events.
// Phase 3 writes this property; phase 2 reads it and falls back gracefully.
export const ORGANISER_UPN_PROP_ID =
  "String {00000000-0000-0000-0000-000000000001} Name OrganiserUpn";

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
  fallbackRoomId: string
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
// Sync a single mailbox
// ---------------------------------------------------------------------------

async function syncMailbox(
  mailboxUpn: string,
  fallbackRoomId: string,
  mailboxToRoomId: Map<string, string>,
  sectionToParentId: Map<string, string>
): Promise<{ added: number; updated: number; removed: number }> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days

  // Fetch all events in the window, paginating through nextLinks.
  const events: GraphEvent[] = [];
  let url =
    `/users/${encodeURIComponent(mailboxUpn)}/calendarView` +
    `?startDateTime=${now.toISOString()}` +
    `&endDateTime=${windowEnd.toISOString()}` +
    `&$select=id,iCalUId,subject,start,end,isAllDay,organizer,attendees,singleValueExtendedProperties` +
    `&$expand=singleValueExtendedProperties($filter=id eq '${ORGANISER_UPN_PROP_ID}')` +
    `&$top=100`;

  while (url) {
    const page = await graphClient.getCalendar<GraphCalendarViewResponse>(url);
    events.push(...page.value);
    url = page["@odata.nextLink"] ?? "";
  }

  // Current DB state keyed by iCalUId for dedup.
  const dbRows = await db.booking.findMany({
    where: { roomId: fallbackRoomId },
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
      fallbackRoomId
    );

    const organiserProp = event.singleValueExtendedProperties?.find(
      (p) => p.id === ORGANISER_UPN_PROP_ID
    );
    const organiserUpn =
      organiserProp?.value ?? event.organizer.emailAddress.address;

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

  // Delete bookings no longer in Exchange.
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
        mailboxToRoomId,
        sectionToParentId
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
    "graph: resync_completed"
  );
}
