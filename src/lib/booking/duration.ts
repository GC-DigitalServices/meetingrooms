const SLOT_MS = 15 * 60 * 1000;   // 15 minutes
const MIN_MS  = 15 * 60 * 1000;   // minimum booking length
export const MAX_MS = 8 * 60 * 60 * 1000; // maximum booking length

/** Snap a date to the nearest 15-minute boundary. */
export function snapToSlot(date: Date): Date {
  const ms = date.getTime();
  return new Date(Math.round(ms / SLOT_MS) * SLOT_MS);
}

/**
 * Validates that end − start is between 15 min and 8 h (inclusive).
 * Both dates should already be snapped before calling.
 * Throws a plain Error with a descriptive message on failure.
 */
export function validateDuration(start: Date, end: Date): void {
  const ms = end.getTime() - start.getTime();
  if (ms < MIN_MS) throw new Error("Booking must be at least 15 minutes");
  if (ms > MAX_MS) throw new Error("Booking cannot exceed 8 hours");
  if (ms <= 0)     throw new Error("End time must be after start time");
}

/** Room kinds exempt from the duration cap — multi-day hires are legitimate. */
const CAP_EXEMPT_KINDS = new Set<string>(["MINIBUS"]);

/**
 * Whether a booking is longer than this app would ever create — i.e. over the
 * cap `validateDuration` enforces on the write path. Only ever true for events
 * written to a room mailbox by something other than us, which in practice means
 * Salamander.
 *
 * It fires on Salamander publishing a term of a weekly lesson as one continuous
 * event (14 Sep 12:35 → 14 Dec 13:35) rather than a recurring series, which
 * reads as the room being busy every hour of every day in between.
 *
 * This is a *report*, never a filter. Exchange is the source of truth
 * (invariant 1): the row still mirrors, because the room really is blocked and
 * the conflict check must keep saying so. All this does is surface the data
 * error at sync time instead of leaving it to be noticed as a greyed-out
 * calendar weeks later.
 */
export function isOverlongRoomBooking(kind: string, start: Date, end: Date): boolean {
  if (CAP_EXEMPT_KINDS.has(kind)) return false;
  return end.getTime() - start.getTime() > MAX_MS;
}
