export type BookingVisibility = "full" | "busy";

interface Viewer {
  upn: string;
  isStaff: boolean;
  isAdmin: boolean;
}

interface RoomVisibilityInput {
  bookable: boolean;
}

interface BookingVisibilityInput {
  organiserUpn: string;
  organiserIsStaff: boolean;
}

/**
 * Returns true if the viewer should see this room in the room list.
 *
 * Rules:
 *   staff / admin  → always visible
 *   student        → only bookable rooms, unless showAll is set
 */
export function canSeeRoom(
  viewer: Pick<Viewer, "isStaff" | "isAdmin">,
  room: RoomVisibilityInput,
  showAll = false
): boolean {
  if (viewer.isAdmin || viewer.isStaff) return true;
  if (room.bookable) return true;
  return showAll;
}

/**
 * Returns whether the viewer sees full booking detail or just "busy".
 *
 * Rules (from CLAUDE.md):
 *   own booking                              → full
 *   admin                                   → full
 *   student-organised (organiserIsStaff=F)  → busy for everyone else
 *   staff-organised   (organiserIsStaff=T)  → full for staff, busy for students
 */
export function bookingDetailVisibility(
  viewer: Viewer,
  booking: BookingVisibilityInput
): BookingVisibility {
  if (viewer.upn === booking.organiserUpn) return "full";
  if (viewer.isAdmin) return "full";
  if (!booking.organiserIsStaff) return "busy";
  return viewer.isStaff ? "full" : "busy";
}
