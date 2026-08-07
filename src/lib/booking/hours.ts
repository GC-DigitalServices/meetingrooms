import { localDateISO, londonMinutesOfDay } from "@/lib/utils";

/**
 * Bookable hours, minutes from midnight (Europe/London wall clock).
 * The single source of truth — booking forms, slot suggestions and
 * quick-book buttons must all agree on when a booking may start and end.
 * (Timeline/grid VIEW windows may be wider than this for context.)
 */
export const BOOKABLE_START_MIN = 7 * 60; // 07:00
export const BOOKABLE_END_MIN = 21 * 60; // 21:00

/** Booking slot granularity in minutes. */
export const SLOT_STEP_MIN = 15;

/** Room kinds exempt from time-of-day enforcement (multi-day / overnight hires). */
const HOURS_EXEMPT_KINDS = new Set<string>(["MINIBUS"]);

/**
 * Whether a booking [start, end) falls within bookable hours in Europe/London:
 * the same London day, starting no earlier than BOOKABLE_START_MIN and ending no
 * later than BOOKABLE_END_MIN. Comparison is in London wall-clock (DST-safe) so
 * it matches the client's slot pickers. MINIBUS is exempt (multi-day hires).
 *
 * This is the server-side guard behind the client-only time dropdowns — the API
 * must not trust the client to have filtered out-of-hours times.
 */
export function isWithinBookableHours(kind: string, start: Date, end: Date): boolean {
  if (HOURS_EXEMPT_KINDS.has(kind)) return true;
  if (localDateISO(start) !== localDateISO(end)) return false;
  const startMin = londonMinutesOfDay(start);
  const endMin = londonMinutesOfDay(end);
  return startMin >= BOOKABLE_START_MIN && endMin <= BOOKABLE_END_MIN && startMin < endMin;
}
