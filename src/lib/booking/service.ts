import { db } from "@/lib/db/client";
import { canUserBookRoom, wouldPassWithoutAdmin } from "./permissions";
import { findConflict } from "./conflicts";
import { snapToSlot, validateDuration } from "./duration";
import { isWithinBookableHours } from "./hours";
import { isWithinBookingHorizon, horizonDays } from "./horizon";
import { resolveBookingMailboxes, bookingLockKey } from "./mailboxes";
import { ConflictError, NotOrganiserError, GraphUnavailableError, RoomNotBookableError, OutOfHoursError, BeyondHorizonError } from "./errors";
import { isGraphDegraded, markGraphDegraded, clearGraphDegraded } from "./graph-health";
import { withLock } from "@/lib/realtime/lock";
import { createGraphEvent, updateGraphEvent, deleteGraphEvent } from "@/lib/graph/events";
import { writeAudit } from "@/lib/db/audit";
import {
  shouldNotifyPremises,
  sendPremisesNotification,
  sendParkingConfirmation,
  sendMinibusConfirmation,
  computePremisesHash,
  formatLocal,
} from "@/lib/mailer";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { addLondonWeeks } from "@/lib/utils";
import {
  publishBookingCreated,
  publishBookingUpdated,
  publishBookingDeleted,
} from "@/lib/realtime/publish";
import type { Booking } from "@prisma/client";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface ActorUser {
  upn: string;
  isAdmin: boolean;
  groupIds: string[];
}

export interface CreateBookingInput {
  roomId: string;
  organiserUpn: string;
  organiserName: string;
  subject: string;
  start: Date;
  end: Date;
  premisesNotes?: string | null;
  actor: ActorUser;
  recurringGroupId?: string;
  /**
   * Set by createRecurringBookings: the per-occurrence email is suppressed so
   * the series can be reported once, with every date, after the loop.
   */
  deferPremisesNotify?: boolean;
}

export interface UpdateBookingInput {
  subject?: string;
  start?: Date;
  end?: Date;
  premisesNotes?: string | null;
  actor: ActorUser;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadRoomWithSections(roomId: string) {
  return db.room.findUniqueOrThrow({
    where: { id: roomId },
    include: { sections: true },
  });
}

type RoomWithSections = Awaited<ReturnType<typeof loadRoomWithSections>>;

/** Returns all room IDs in the booking family (for conflict checks). */
async function familyRoomIds(room: RoomWithSections): Promise<string[]> {
  if (room.kind === "COMPOSITE") {
    return [room.id, ...room.sections.map((s) => s.id)];
  }
  if (room.kind === "PARKING") {
    // Conflict check across all bay IDs (pool itself has no bookings)
    return room.sections.map((s) => s.id);
  }
  if (room.kind === "PARKING_BAY" && room.parentRoomId) {
    const siblings = await db.room.findMany({
      where: { parentRoomId: room.parentRoomId },
      select: { id: true },
    });
    return siblings.map((s) => s.id);
  }
  if (room.kind === "SECTION" && room.parentRoomId) {
    const siblings = await db.room.findMany({
      where: { parentRoomId: room.parentRoomId },
      select: { id: true },
    });
    return [room.parentRoomId, ...siblings.map((s) => s.id)];
  }
  return [room.id];
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  const room = await loadRoomWithSections(input.roomId);

  // 1. Permission check — admin bypass is audited
  const isAdminOverride =
    input.actor.isAdmin && !wouldPassWithoutAdmin(input.actor, room);

  if (!input.actor.isAdmin) {
    canUserBookRoom(input.actor, room);
    if (room.kind === "COMPOSITE") {
      for (const section of room.sections) canUserBookRoom(input.actor, section);
    }
  }

  // Snap and validate
  const start = snapToSlot(input.start);
  const end   = snapToSlot(input.end);
  // MINIBUS bookings can span multiple days — no duration cap applied.
  if (room.kind !== "MINIBUS") validateDuration(start, end);
  // Enforce operating hours server-side (the client dropdowns are not trusted).
  if (!isWithinBookableHours(room.kind, start, end)) throw new OutOfHoursError();
  // Enforce the booking horizon server-side for the same reason: the date
  // pickers' `max` attribute is a hint, not a limit. Admins get a longer one.
  if (!isWithinBookingHorizon(input.actor.isAdmin, room.kind, start)) {
    throw new BeyondHorizonError(
      `Bookings can be made up to ${horizonDays(input.actor.isAdmin, room.kind)} days ahead.`
    );
  }

  if (room.kind === "MINIBUS" && !input.premisesNotes?.trim()) {
    throw new RoomNotBookableError("Destination, passengers and driver are required for minibus bookings.");
  }

  const isParking = room.kind === "PARKING";
  let mailboxes: string[] = [];
  let primaryMbox = "";
  let bookingRoomId = input.roomId;

  if (!isParking) {
    mailboxes = resolveBookingMailboxes(room, room.sections);
    primaryMbox = mailboxes[0];
  }

  const lockKey = bookingLockKey(room.id, room.kind, room.parentRoomId);
  const roomIds = await familyRoomIds(room);

  // Fail fast before acquiring the lock if Graph is known degraded
  if (await isGraphDegraded()) throw new GraphUnavailableError();

  const booking = await withLock(lockKey, async () => {
    // 3. Conflict check (authoritative inside the lock)
    const existing = await db.booking.findMany({
      where: { roomId: { in: roomIds }, startUtc: { lt: end }, endUtc: { gt: start } },
    });

    if (isParking) {
      // A pool has several bays; one busy bay must NOT block the whole pool.
      // So skip the blanket family conflict check and instead pick any free
      // bay. (Running findConflict across all bays here would throw as soon as
      // a single bay was occupied, making a multi-bay pool behave as one bay.)
      const busyBayIds = new Set(existing.map((c) => c.roomId));
      const freeBay = room.sections.find((b) => !!b.mailboxUpn && !busyBayIds.has(b.id));
      if (!freeBay) throw new ConflictError("No car park bays available at this time");
      primaryMbox = freeBay.mailboxUpn!;
      mailboxes = []; // no resource attendees — event sits on bay calendar only
      bookingRoomId = freeBay.id;
    } else {
      // Rooms (incl. composite/section family): any overlap in the family conflicts.
      const conflict = findConflict({ startUtc: start, endUtc: end }, existing);
      if (conflict) throw new ConflictError(`Conflicts with: ${conflict.subject}`);
    }

    // 4. Graph write
    let graphEvent;
    try {
      graphEvent = await createGraphEvent(primaryMbox, {
        organiserUpn:        input.organiserUpn,
        organiserName:       input.organiserName,
        subject:             input.subject,
        startUtc:            start,
        endUtc:              end,
        resourceMailboxes:   mailboxes,
        source:              "PORTAL",
        bookingId:           "pending", // patched asynchronously below
        // Parking and minibus bookers are confirmed by email, not a calendar
        // invite — don't add them as an attendee.
        skipOrganiserInvite: isParking || room.kind === "MINIBUS",
      });
      clearGraphDegraded();
    } catch (err) {
      logger.error({ err, roomId: room.id, action: "create" }, "booking: Graph write failed");
      markGraphDegraded();
      throw new GraphUnavailableError();
    }

    // 5. Postgres mirror
    const premisesNotes = input.premisesNotes ?? null;
    const premisesNotifyHash = shouldNotifyPremises(room.kind, premisesNotes)
      ? computePremisesHash({ roomId: room.id, organiserUpn: input.organiserUpn, startUtc: start, endUtc: end, premisesNotes })
      : null;

    const mirror = {
      graphEventId:      graphEvent.id,
      graphICalUid:      graphEvent.iCalUId,
      roomId:            bookingRoomId,
      organiserUpn:      input.organiserUpn,
      organiserName:     input.organiserName,
      subject:           input.subject,
      startUtc:          start,
      endUtc:            end,
      isAllDay:          false,
      source:            "PORTAL" as const,
      premisesNotes,
      premisesNotifyHash,
      primaryMailboxUpn: primaryMbox,
      lastSyncedAt:      new Date(),
      recurringGroupId:  input.recurringGroupId ?? null,
    };

    // Upsert, not create: the room-mailbox webhook fires on our own Graph write
    // and mirrorEvent can land the row first — most easily during a recurring
    // series, where the loop is still writing later weeks when the notification
    // for an earlier one arrives. A plain create then failed the graphICalUid /
    // graphEventId unique constraints and the whole request 500'd, leaving the
    // Exchange event orphaned. Our data is the fuller of the two (the webhook
    // knows nothing of premisesNotes, primaryMailboxUpn or recurringGroupId),
    // so it wins.
    const created = await db.booking.upsert({
      where:  { graphICalUid: graphEvent.iCalUId },
      create: mirror,
      update: mirror,
    });

    // Patch BookingId extended property now that we have the real id (fire-and-forget)
    updateGraphEvent(primaryMbox, graphEvent.id, {}).catch((err) =>
      logger.warn({ err, bookingId: created.id }, "booking: BookingId patch failed (non-critical)")
    );

    // 7. Audit
    await writeAudit({
      actor:    input.actor.upn,
      action:   "booking.create",
      targetId: created.id,
      metadata: {
        roomId:       input.roomId,
        organiserUpn: input.organiserUpn,
        start:        start.toISOString(),
        end:          end.toISOString(),
        ...(room.kind === "COMPOSITE" && { kind: "COMPOSITE", sectionIds: room.sections.map((s) => s.id) }),
        ...(isAdminOverride && { adminOverride: true, targetOrganiserUpn: input.organiserUpn }),
      },
    });

    // 8. Premises notification (best-effort, isolated)
    if (shouldNotifyPremises(room.kind, premisesNotes) && !input.deferPremisesNotify) {
      const { PUBLIC_BASE_URL } = getConfig();
      await sendPremisesNotification({
        bookingId:       created.id,
        action:          "CREATE",
        organiserName:   input.organiserName,
        roomDisplayName: room.displayName,
        roomKind:        room.kind,
        startLocal:      formatLocal(start),
        endLocal:        formatLocal(end),
        premisesNotes,
        portalUrl:       PUBLIC_BASE_URL,
        actorUpn:        input.actor.upn,
      });
    }

    // Minibus: email the booker a confirmation with the safety-check checklist
    // attached (best-effort; the Exchange calendar invite is still sent too).
    if (room.kind === "MINIBUS") {
      const { PUBLIC_BASE_URL } = getConfig();
      sendMinibusConfirmation({
        bookingId:          created.id,
        organiserUpn:       input.organiserUpn,
        organiserName:      input.organiserName,
        minibusDisplayName: room.displayName,
        startUtc:           start,
        endUtc:             end,
        portalUrl:          PUBLIC_BASE_URL,
      }).catch((err) =>
        logger.warn({ err, bookingId: created.id }, "mailer: minibus_confirmation fire-and-forget failed")
      );
    }

    // Parking: send email confirmation in place of calendar invite
    if (isParking) {
      const { PUBLIC_BASE_URL } = getConfig();
      sendParkingConfirmation({
        bookingId:       created.id,
        organiserUpn:    input.organiserUpn,
        organiserName:   input.organiserName,
        poolDisplayName: room.displayName,
        startUtc:        start,
        endUtc:          end,
        portalUrl:       PUBLIC_BASE_URL,
      }).catch((err) =>
        logger.warn({ err, bookingId: created.id }, "mailer: parking_confirmation fire-and-forget failed")
      );
    }

    return created;
  });

  // 9. Socket.IO broadcast (outside the lock — non-blocking, fire-and-forget)
  const broadcastParentId = isParking ? room.id : room.parentRoomId;
  publishBookingCreated(booking, broadcastParentId).catch((err) =>
    logger.warn({ err, bookingId: booking.id }, "ws: booking.created broadcast failed")
  );

  return booking;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateBooking(
  bookingId: string,
  input: UpdateBookingInput
): Promise<Booking> {
  const existing = await db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { room: { include: { sections: true } } },
  });

  // Only organiser or admin
  const isAdminOverride = input.actor.isAdmin && input.actor.upn !== existing.organiserUpn;
  if (input.actor.upn !== existing.organiserUpn && !input.actor.isAdmin) {
    throw new NotOrganiserError();
  }

  const room   = existing.room;
  const lockKey = bookingLockKey(room.id, room.kind, room.parentRoomId);

  // Snap times if provided
  const newStart = input.start ? snapToSlot(input.start) : existing.startUtc;
  const newEnd   = input.end   ? snapToSlot(input.end)   : existing.endUtc;
  // MINIBUS hires can span multiple days — same duration-cap bypass as createBooking.
  if (room.kind !== "MINIBUS") validateDuration(newStart, newEnd);
  if (!isWithinBookableHours(room.kind, newStart, newEnd)) throw new OutOfHoursError();
  if (!isWithinBookingHorizon(input.actor.isAdmin, room.kind, newStart)) {
    throw new BeyondHorizonError(
      `Bookings can be moved up to ${horizonDays(input.actor.isAdmin, room.kind)} days ahead.`
    );
  }

  const primaryMbox = existing.primaryMailboxUpn ?? room.mailboxUpn!;
  const roomIds     = await familyRoomIds(room);

  // Fail fast before acquiring the lock if Graph is known degraded
  if (await isGraphDegraded()) throw new GraphUnavailableError();

  const updated = await withLock(lockKey, async () => {
    // Conflict check (exclude this booking)
    const others = await db.booking.findMany({
      where: {
        roomId:      { in: roomIds },
        startUtc:    { lt: newEnd },
        endUtc:      { gt: newStart },
        NOT:         { id: bookingId },
      },
    });
    const conflict = findConflict({ startUtc: newStart, endUtc: newEnd }, others);
    if (conflict) throw new ConflictError(`Conflicts with: ${conflict.subject}`);

    const newSubject      = input.subject      ?? existing.subject;
    const newPremisesNotes = input.premisesNotes !== undefined ? input.premisesNotes : existing.premisesNotes;

    // Graph update
    try {
      await updateGraphEvent(primaryMbox, existing.graphEventId, {
        organiserName: existing.organiserName,
        subject:       newSubject,
        startUtc:      newStart,
        endUtc:        newEnd,
      });
      clearGraphDegraded();
    } catch (err) {
      logger.error({ err, bookingId, action: "update" }, "booking: Graph write failed");
      markGraphDegraded();
      throw new GraphUnavailableError();
    }

    // Idempotency: only update hash (and notify later) if notify-relevant fields changed
    const newHash = shouldNotifyPremises(room.kind, newPremisesNotes)
      ? computePremisesHash({
          roomId:       room.id,
          organiserUpn: existing.organiserUpn,
          startUtc:     newStart,
          endUtc:       newEnd,
          premisesNotes: newPremisesNotes ?? null,
        })
      : null;
    const hashChanged = newHash !== existing.premisesNotifyHash;

    const result = await db.booking.update({
      where: { id: bookingId },
      data: {
        subject:           newSubject,
        startUtc:          newStart,
        endUtc:            newEnd,
        premisesNotes:     newPremisesNotes ?? null,
        premisesNotifyHash: newHash,
        lastSyncedAt:      new Date(),
      },
    });

    await writeAudit({
      actor:    input.actor.upn,
      action:   "booking.update",
      targetId: bookingId,
      metadata: {
        ...(isAdminOverride && { adminOverride: true, targetOrganiserUpn: existing.organiserUpn }),
      },
    });

    if (hashChanged && shouldNotifyPremises(room.kind, newPremisesNotes)) {
      const { PUBLIC_BASE_URL } = getConfig();
      await sendPremisesNotification({
        bookingId,
        action:          "UPDATED",
        organiserName:   existing.organiserName,
        roomDisplayName: room.displayName,
        roomKind:        room.kind,
        startLocal:      formatLocal(newStart),
        endLocal:        formatLocal(newEnd),
        premisesNotes:   newPremisesNotes ?? null,
        portalUrl:       PUBLIC_BASE_URL,
        actorUpn:        input.actor.upn,
      });
    }

    return result;
  });

  // Socket.IO broadcast (outside the lock — fire-and-forget)
  publishBookingUpdated(updated, room.parentRoomId).catch((err) =>
    logger.warn({ err, bookingId }, "ws: booking.updated broadcast failed")
  );

  return updated;
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export async function cancelBooking(
  bookingId: string,
  actor: ActorUser
): Promise<void> {
  const existing = await db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { room: true },
  });

  const isAdminOverride = actor.isAdmin && actor.upn !== existing.organiserUpn;
  if (actor.upn !== existing.organiserUpn && !actor.isAdmin) {
    throw new NotOrganiserError();
  }

  const room       = existing.room;
  const lockKey    = bookingLockKey(room.id, room.kind, room.parentRoomId);
  const primaryMbox = existing.primaryMailboxUpn ?? room.mailboxUpn!;

  // Fail fast before acquiring the lock if Graph is known degraded
  if (await isGraphDegraded()) throw new GraphUnavailableError();

  await withLock(lockKey, async () => {
    try {
      await deleteGraphEvent(primaryMbox, existing.graphEventId);
      clearGraphDegraded();
    } catch (err) {
      logger.error({ err, bookingId, action: "cancel" }, "booking: Graph write failed");
      markGraphDegraded();
      throw new GraphUnavailableError();
    }
    await db.booking.delete({ where: { id: bookingId } });

    await writeAudit({
      actor:    actor.upn,
      action:   "booking.cancel",
      targetId: bookingId,
      metadata: {
        roomId:       room.id,
        organiserUpn: existing.organiserUpn,
        start:        existing.startUtc.toISOString(),
        ...(isAdminOverride && { adminOverride: true, targetOrganiserUpn: existing.organiserUpn }),
      },
    });

    if (shouldNotifyPremises(room.kind, existing.premisesNotes)) {
      const { PUBLIC_BASE_URL } = getConfig();
      await sendPremisesNotification({
        bookingId,
        action:          "CANCELLED",
        organiserName:   existing.organiserName,
        roomDisplayName: room.displayName,
        roomKind:        room.kind,
        startLocal:      formatLocal(existing.startUtc),
        endLocal:        formatLocal(existing.endUtc),
        premisesNotes:   existing.premisesNotes,
        portalUrl:       PUBLIC_BASE_URL,
        actorUpn:        actor.upn,
      });
    }
  });

  // Socket.IO broadcast (outside the lock — fire-and-forget)
  publishBookingDeleted(room.id, bookingId, room.parentRoomId).catch((err) =>
    logger.warn({ err, bookingId }, "ws: booking.deleted broadcast failed")
  );
}

// ---------------------------------------------------------------------------
// Recurring
// ---------------------------------------------------------------------------

export interface CreateRecurringBookingInput extends CreateBookingInput {
  repeatWeeks: number;
}

export interface RecurringBookingResult {
  created: Booking[];
  skipped: Date[];
  aborted: boolean;
}

export async function createRecurringBookings(
  input: CreateRecurringBookingInput
): Promise<RecurringBookingResult> {
  const groupId = crypto.randomUUID();
  const created: Booking[] = [];
  const skipped: Date[] = [];

  // Check the last occurrence before writing anything — createBooking would
  // otherwise create the early weeks and then throw partway through the series.
  const { kind, displayName } = await db.room.findUniqueOrThrow({
    where: { id: input.roomId },
    select: { kind: true, displayName: true },
  });
  const lastStart = addLondonWeeks(input.start, input.repeatWeeks - 1);
  if (!isWithinBookingHorizon(input.actor.isAdmin, kind, lastStart)) {
    throw new BeyondHorizonError(
      `The last of these ${input.repeatWeeks} weekly bookings falls beyond the ` +
        `${horizonDays(input.actor.isAdmin, kind)} days ahead you can book. Choose fewer weeks or an earlier start.`
    );
  }

  for (let i = 0; i < input.repeatWeeks; i++) {
    // Shift by whole weeks in Europe/London wall-clock so a 09:00 series stays
    // 09:00 local across a DST change (a fixed 7×24h offset would drift ±1h).
    const start = addLondonWeeks(input.start, i);
    const end   = addLondonWeeks(input.end, i);

    try {
      const booking = await createBooking({
        ...input,
        start,
        end,
        recurringGroupId: groupId,
        deferPremisesNotify: true,
      });
      created.push(booking);
    } catch (err) {
      if (err instanceof ConflictError) {
        skipped.push(start);
      } else if (err instanceof GraphUnavailableError) {
        await notifyPremisesOfSeries(input, kind, displayName, created, skipped);
        return { created, skipped, aborted: true };
      } else {
        throw err;
      }
    }
  }

  await notifyPremisesOfSeries(input, kind, displayName, created, skipped);
  return { created, skipped, aborted: false };
}

/**
 * One premises email for a whole weekly series, sent after the loop so it can
 * list the dates that were actually booked and the ones that were skipped as
 * conflicts. createBooking's per-occurrence email is deferred for this — ten
 * near-identical emails for one series is how a real prep request gets missed.
 *
 * Best-effort, like every other premises notification: sendPremisesNotification
 * swallows its own failures, and nothing here may unwind bookings already
 * written to Exchange.
 */
async function notifyPremisesOfSeries(
  input: CreateRecurringBookingInput,
  roomKind: string,
  roomDisplayName: string,
  created: Booking[],
  skipped: Date[]
): Promise<void> {
  const premisesNotes = input.premisesNotes ?? null;
  if (!created.length || !shouldNotifyPremises(roomKind, premisesNotes)) return;

  const { PUBLIC_BASE_URL } = getConfig();
  await sendPremisesNotification({
    bookingId:       created[0].id,
    action:          "CREATE",
    organiserName:   input.organiserName,
    roomDisplayName,
    roomKind,
    startLocal:      formatLocal(created[0].startUtc),
    endLocal:        formatLocal(created[0].endUtc),
    occurrences:     created.map((b) => ({
      startLocal: formatLocal(b.startUtc),
      endLocal:   formatLocal(b.endUtc),
    })),
    skipped:         skipped.map(formatLocal),
    premisesNotes,
    portalUrl:       PUBLIC_BASE_URL,
    actorUpn:        input.actor.upn,
  });
}

export async function cancelRemainingRecurring(
  groupId: string,
  actor: ActorUser
): Promise<number> {
  const now = new Date();
  const future = await db.booking.findMany({
    where: {
      recurringGroupId: groupId,
      organiserUpn: actor.upn,
      startUtc: { gt: now },
    },
    select: { id: true },
  });

  let count = 0;
  for (const { id } of future) {
    await cancelBooking(id, actor);
    count++;
  }
  return count;
}
