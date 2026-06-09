import { db } from "@/lib/db/client";
import { canUserBookRoom, wouldPassWithoutAdmin } from "./permissions";
import { findConflict } from "./conflicts";
import { snapToSlot, validateDuration } from "./duration";
import { resolveBookingMailboxes, bookingLockKey } from "./mailboxes";
import { ConflictError, NotOrganiserError, GraphUnavailableError } from "./errors";
import { isGraphDegraded, markGraphDegraded, clearGraphDegraded } from "./graph-health";
import { withLock } from "@/lib/realtime/lock";
import { createGraphEvent, updateGraphEvent, deleteGraphEvent } from "@/lib/graph/events";
import { writeAudit } from "@/lib/db/audit";
import {
  shouldNotifyPremises,
  sendPremisesNotification,
  computePremisesHash,
  formatLocal,
} from "@/lib/mailer";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
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
  validateDuration(start, end);

  if (room.kind === "MINIBUS" && !input.premisesNotes?.trim()) {
    throw new Error("Minibus bookings require premisesNotes (destination, passengers, driver)");
  }

  const mailboxes    = resolveBookingMailboxes(room, room.sections);
  const primaryMbox  = mailboxes[0];
  const lockKey      = bookingLockKey(room.id, room.kind, room.parentRoomId);
  const roomIds      = await familyRoomIds(room);

  // Fail fast before acquiring the lock if Graph is known degraded
  if (await isGraphDegraded()) throw new GraphUnavailableError();

  const booking = await withLock(lockKey, async () => {
    // 3. Conflict check (authoritative inside the lock)
    const existing = await db.booking.findMany({
      where: { roomId: { in: roomIds }, startUtc: { lt: end }, endUtc: { gt: start } },
    });
    const conflict = findConflict({ startUtc: start, endUtc: end }, existing);
    if (conflict) throw new ConflictError(`Conflicts with: ${conflict.subject}`);

    // 4. Graph write
    let graphEvent;
    try {
      graphEvent = await createGraphEvent(primaryMbox, {
        organiserUpn:     input.organiserUpn,
        organiserName:    input.organiserName,
        subject:          input.subject,
        startUtc:         start,
        endUtc:           end,
        resourceMailboxes: mailboxes,
        source:           "PORTAL",
        bookingId:        "pending", // patched asynchronously below
      });
      clearGraphDegraded();
    } catch {
      markGraphDegraded();
      throw new GraphUnavailableError();
    }

    // 5. Postgres mirror
    const premisesNotes = input.premisesNotes ?? null;
    const premisesNotifyHash = shouldNotifyPremises(room.kind, premisesNotes)
      ? computePremisesHash({ roomId: room.id, organiserUpn: input.organiserUpn, startUtc: start, endUtc: end, premisesNotes })
      : null;

    const created = await db.booking.create({
      data: {
        graphEventId:      graphEvent.id,
        graphICalUid:      graphEvent.iCalUId,
        roomId:            input.roomId,
        organiserUpn:      input.organiserUpn,
        organiserName:     input.organiserName,
        subject:           input.subject,
        startUtc:          start,
        endUtc:            end,
        isAllDay:          false,
        source:            "PORTAL",
        premisesNotes,
        premisesNotifyHash,
        primaryMailboxUpn: primaryMbox,
        lastSyncedAt:      new Date(),
      },
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
    if (shouldNotifyPremises(room.kind, premisesNotes)) {
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

    return created;
  });

  // 9. Socket.IO broadcast (outside the lock — non-blocking, fire-and-forget)
  publishBookingCreated(booking, room.parentRoomId).catch((err) =>
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
  validateDuration(newStart, newEnd);

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
    } catch {
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
    } catch {
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
