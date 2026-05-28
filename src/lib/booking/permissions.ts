import { NotPermittedError, RoomNotBookableError } from "./errors";

interface UserPermissionInput {
  isAdmin: boolean;
  groupIds: string[];
}

interface RoomPermissionInput {
  bookable: boolean;
  allowedGroups: string[];
}

/**
 * Returns true if the user may book the room, throws otherwise.
 *
 * Rules (from CLAUDE.md):
 *   isAdmin               → true (caller must add adminOverride: true to audit)
 *   allowedGroups empty   → true (any signed-in user)
 *   else                  → user.groupIds intersects room.allowedGroups
 */
export function canUserBookRoom(
  user: UserPermissionInput,
  room: RoomPermissionInput
): true {
  if (user.isAdmin) return true;
  if (!room.bookable) throw new RoomNotBookableError();
  if (room.allowedGroups.length === 0) return true;
  if (room.allowedGroups.some((g) => user.groupIds.includes(g))) return true;
  throw new NotPermittedError();
}

/**
 * Returns whether the standard (non-admin) permission check would pass.
 * Used to determine adminOverride flag in the audit log.
 */
export function wouldPassWithoutAdmin(
  user: UserPermissionInput,
  room: RoomPermissionInput
): boolean {
  if (!room.bookable) return false;
  if (room.allowedGroups.length === 0) return true;
  return room.allowedGroups.some((g) => user.groupIds.includes(g));
}
