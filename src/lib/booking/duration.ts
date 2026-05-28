const SLOT_MS = 15 * 60 * 1000;   // 15 minutes
const MIN_MS  = 15 * 60 * 1000;   // minimum booking length
const MAX_MS  = 8 * 60 * 60 * 1000; // maximum booking length

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
