import { localTime, localDateISO, minutesToTime } from "@/lib/utils";
import { BOOKABLE_START_MIN, BOOKABLE_END_MIN, SLOT_STEP_MIN } from "./hours";

interface Slotish {
  startUtc: string;
  endUtc: string;
}

/** "Free until 14:00" / "Free all day" for a currently-free room. */
export function freeUntilLabel(bookings: Slotish[], now: Date): string {
  const today = localDateISO(now);
  const next = bookings
    .filter((b) => new Date(b.startUtc) > now)
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc))[0];
  if (!next || localDateISO(next.startUtc) !== today) return "Free all day";
  return `Free until ${localTime(next.startUtc)}`;
}

/** "Busy until 15:30" for a currently-busy room. */
export function busyUntilLabel(bookings: Slotish[], now: Date): string {
  const current = bookings.find((b) => new Date(b.startUtc) <= now && new Date(b.endUtc) > now);
  return current ? `Busy until ${localTime(current.endUtc)}` : "";
}

/** "Booked at 10:00" when the next booking starts within 30 minutes. */
export function bookedAtLabel(bookings: Slotish[], now: Date): string {
  const soon = new Date(now.getTime() + 30 * 60 * 1000);
  const next = bookings
    .filter((b) => new Date(b.startUtc) > now && new Date(b.startUtc) <= soon)
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc))[0];
  return next ? `Booked at ${localTime(next.startUtc)}` : "";
}

export interface FreeSlot {
  start: string; // HH:mm
  end: string; // HH:mm
}

/**
 * First slot of `durationMin` minutes on `date` (YYYY-MM-DD, Europe/London
 * wall clock) with no overlapping booking, scanning 15-minute steps between
 * `firstStart` and `lastEnd` (minutes since midnight) and never in the past.
 * Assumes the browser is set to Europe/London, like the rest of the client.
 */
export function findNextFreeSlot(
  bookings: Slotish[],
  date: string,
  durationMin: number,
  firstStart = BOOKABLE_START_MIN,
  lastEnd = BOOKABLE_END_MIN,
): FreeSlot | null {
  const dayBaseMs = new Date(`${date}T00:00:00`).getTime();
  const busy = bookings.map((b) => ({
    s: new Date(b.startUtc).getTime(),
    e: new Date(b.endUtc).getTime(),
  }));
  const nowMs = Date.now();
  for (let m = firstStart; m + durationMin <= lastEnd; m += SLOT_STEP_MIN) {
    const s = dayBaseMs + m * 60_000;
    if (s < nowMs) continue;
    const e = s + durationMin * 60_000;
    if (!busy.some((b) => b.s < e && b.e > s)) {
      return { start: minutesToTime(m), end: minutesToTime(m + durationMin) };
    }
  }
  return null;
}
