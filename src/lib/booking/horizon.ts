import { localDateISO } from "@/lib/utils";

/**
 * How far ahead a booking may start, in calendar days from today.
 * The single source of truth — date pickers, date navigation and the API
 * guard must all agree on how far ahead a booking may be made.
 */
export const BOOKING_HORIZON_DAYS = 60;

/**
 * Admins booking a room get a full academic year, and SYNC_WINDOW_DAYS (370) is
 * set to cover it. The two are coupled: the conflict check reads our Postgres
 * cache, and the cache only mirrors externally-written calendar events — the
 * Salamander/MIS timetable, which is populated a whole year ahead — as far out
 * as the sync window. A room booked beyond the window would be checked against
 * a cache that cannot see what the timetable has already claimed. Never raise
 * this above SYNC_WINDOW_DAYS.
 */
export const ADMIN_BOOKING_HORIZON_DAYS = 365;

/**
 * Minibuses and visitor car park bays have no external writer — every booking
 * on those mailboxes comes through this app — so their horizon does not depend
 * on the sync window at all. Kept as its own value so it can move
 * independently of the room horizon.
 */
export const ADMIN_LONG_HORIZON_DAYS = 360;
const ADMIN_LONG_HORIZON_KINDS = new Set<string>(["MINIBUS", "PARKING"]);

export function horizonDays(isAdmin: boolean, roomKind: string): number {
  if (!isAdmin) return BOOKING_HORIZON_DAYS;
  return ADMIN_LONG_HORIZON_KINDS.has(roomKind)
    ? ADMIN_LONG_HORIZON_DAYS
    : ADMIN_BOOKING_HORIZON_DAYS;
}

/**
 * Latest bookable London date (YYYY-MM-DD) for this viewer and room kind.
 *
 * Calendar-day arithmetic, not wall-clock ms — adding N×24h drifts a day when
 * the span crosses a DST transition near midnight.
 */
export function maxBookableDate(
  isAdmin: boolean,
  roomKind: string,
  from: Date = new Date(),
): string {
  const [y, m, d] = localDateISO(from).split("-").map(Number);
  return localDateISO(new Date(Date.UTC(y, m - 1, d + horizonDays(isAdmin, roomKind))));
}

/**
 * Whether a booking starting at `start` is inside the horizon.
 *
 * This is the server-side guard behind the client-only date pickers — the API
 * must not trust the client to have limited how far ahead a booking starts.
 * Compared as London calendar dates so it agrees exactly with the `max`
 * attribute the pickers enforce: a late slot on the final day is still valid.
 */
export function isWithinBookingHorizon(
  isAdmin: boolean,
  roomKind: string,
  start: Date,
  from: Date = new Date(),
): boolean {
  return localDateISO(start) <= maxBookableDate(isAdmin, roomKind, from);
}
