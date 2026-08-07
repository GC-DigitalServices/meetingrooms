import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Module-level formatter instances — Intl.DateTimeFormat construction is
// expensive and these helpers run per booking per card per render.
const LONDON_TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const LONDON_DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const LONDON_DATE_ISO_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });

/** Format a UTC Date as HH:mm in Europe/London. */
export function localTime(date: Date | string): string {
  return LONDON_TIME_FMT.format(typeof date === "string" ? new Date(date) : date);
}

/** Format a UTC Date as "1 Jun 2026" in Europe/London. */
export function localDate(date: Date | string): string {
  return LONDON_DATE_FMT.format(typeof date === "string" ? new Date(date) : date);
}

/** Format a UTC Date as YYYY-MM-DD in Europe/London. Defaults to now. */
export function localDateISO(date: Date | string = new Date()): string {
  return LONDON_DATE_ISO_FMT.format(typeof date === "string" ? new Date(date) : date);
}

/** "HH:mm" → minutes since midnight. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes since midnight → "HH:mm". */
export function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

const LONDON_HOUR_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  hour12: false,
});

/**
 * UTC instant of midnight in Europe/London on the given YYYY-MM-DD date.
 * London is UTC+0 or UTC+1, so UTC midnight renders there as either 00:00
 * or 01:00 — subtracting that wall-clock hour lands exactly on local midnight.
 */
export function londonDayStartUtc(date: string): Date {
  const utcMidnight = new Date(`${date}T00:00:00Z`);
  const hour = Number(LONDON_HOUR_FMT.format(utcMidnight)) % 24;
  return new Date(utcMidnight.getTime() - hour * 60 * 60 * 1000);
}

/**
 * UTC instant for a wall-clock date + time in Europe/London.
 * `date` is "YYYY-MM-DD", `time` is "HH:mm". London runs at a whole-hour offset
 * (UTC+0 or +1), so we treat the wall-clock as UTC, measure the offset the
 * resulting instant shows in London, and subtract it. Bookable hours never
 * straddle the 01:00/02:00 DST switch, so the transition edge case can't bite.
 */
export function londonToUtc(date: string, time: string): Date {
  const asUtc = new Date(`${date}T${time}:00Z`);
  const shownHour = Number(LONDON_HOUR_FMT.format(asUtc)) % 24;
  let offset = shownHour - asUtc.getUTCHours(); // whole hours; normalise day-wrap
  if (offset > 12) offset -= 24;
  if (offset < -12) offset += 24;
  return new Date(asUtc.getTime() - offset * 60 * 60 * 1000);
}

/** Add whole days to a "YYYY-MM-DD" string (calendar arithmetic, tz-independent). */
function addDaysISO(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Shift a UTC instant by N weeks while keeping the same Europe/London wall-clock
 * time, so a weekly 09:00 booking stays 09:00 local across a DST change rather
 * than drifting ±1h (as a fixed 7×24h offset would).
 */
export function addLondonWeeks(instant: Date, weeks: number): Date {
  return londonToUtc(addDaysISO(localDateISO(instant), weeks * 7), localTime(instant));
}
