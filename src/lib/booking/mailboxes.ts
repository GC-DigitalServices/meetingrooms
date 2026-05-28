interface RoomMailboxInput {
  id: string;
  kind: string;
  mailboxUpn: string | null;
}

/**
 * Returns the list of mailbox UPNs to invite as resource attendees for a booking.
 *
 *   STANDARD / SECTION / MINIBUS → [room.mailboxUpn]
 *   COMPOSITE                    → section mailboxes (all of them)
 *
 * The first element is treated as the primary mailbox (where the Graph event
 * is created and where subsequent updates/deletes are applied).
 */
export function resolveBookingMailboxes(
  room: RoomMailboxInput,
  sections: RoomMailboxInput[]
): string[] {
  if (room.kind === "COMPOSITE") {
    const upns = sections
      .map((s) => s.mailboxUpn)
      .filter((u): u is string => u !== null);
    if (upns.length === 0) {
      throw new Error(`Composite room ${room.id} has no section mailboxes`);
    }
    return upns;
  }

  if (!room.mailboxUpn) {
    throw new Error(`Room ${room.id} has no mailboxUpn`);
  }
  return [room.mailboxUpn];
}

/**
 * Returns the Redis lock key for a booking on this room.
 * Always locks the "family root":
 *   SECTION  → parentRoomId (the composite)
 *   all others → room's own id
 */
export function bookingLockKey(
  roomId: string,
  kind: string,
  parentRoomId: string | null
): string {
  if (kind === "SECTION" && parentRoomId) {
    return `lock:room:${parentRoomId}`;
  }
  return `lock:room:${roomId}`;
}
