import { describe, it, expect } from "vitest";
import { freeUntilLabel, busyUntilLabel, bookedAtLabel, findNextFreeSlot } from "./labels";
import { BOOKABLE_START_MIN, BOOKABLE_END_MIN } from "./hours";

/** Minutes from midnight → "HH:MM", so fixtures track the bookable window. */
function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
const OPEN = hhmm(BOOKABLE_START_MIN);
const CLOSE = hhmm(BOOKABLE_END_MIN);

// Winter (GMT) instants so Europe/London rendering equals the UTC wall clock.
const now = new Date("2030-01-15T10:00:00Z");

function slot(startUtc: string, endUtc: string) {
  return { startUtc, endUtc };
}

describe("freeUntilLabel", () => {
  it("returns 'Free all day' when nothing is booked", () => {
    expect(freeUntilLabel([], now)).toBe("Free all day");
  });

  it("returns 'Free all day' when the next booking is on another day", () => {
    const bookings = [slot("2030-01-16T09:00:00Z", "2030-01-16T10:00:00Z")];
    expect(freeUntilLabel(bookings, now)).toBe("Free all day");
  });

  it("names the next booking start today", () => {
    const bookings = [
      slot("2030-01-15T14:00:00Z", "2030-01-15T15:00:00Z"),
      slot("2030-01-15T12:00:00Z", "2030-01-15T13:00:00Z"),
    ];
    expect(freeUntilLabel(bookings, now)).toBe("Free until 12:00");
  });
});

describe("busyUntilLabel", () => {
  it("names the current booking's end", () => {
    const bookings = [slot("2030-01-15T09:30:00Z", "2030-01-15T11:00:00Z")];
    expect(busyUntilLabel(bookings, now)).toBe("Busy until 11:00");
  });

  it("returns empty when no booking covers now", () => {
    const bookings = [slot("2030-01-15T11:00:00Z", "2030-01-15T12:00:00Z")];
    expect(busyUntilLabel(bookings, now)).toBe("");
  });
});

describe("bookedAtLabel", () => {
  it("names a booking starting within 30 minutes", () => {
    const bookings = [slot("2030-01-15T10:20:00Z", "2030-01-15T11:00:00Z")];
    expect(bookedAtLabel(bookings, now)).toBe("Booked at 10:20");
  });

  it("returns empty when the next booking is further out", () => {
    const bookings = [slot("2030-01-15T11:00:00Z", "2030-01-15T12:00:00Z")];
    expect(bookedAtLabel(bookings, now)).toBe("");
  });
});

describe("findNextFreeSlot", () => {
  // findNextFreeSlot parses `${date}T00:00:00` with the system timezone (the
  // app assumes Europe/London browsers). Building fixtures through the same
  // local parse keeps these tests deterministic in any test-runner timezone.
  const DATE = "2099-06-15"; // far future so the past-time cutoff never trips
  const local = (time: string) => new Date(`${DATE}T${time}:00`).toISOString();

  it("returns the first bookable slot on an empty day", () => {
    expect(findNextFreeSlot([], DATE, 60)).toEqual({
      start: OPEN,
      end: hhmm(BOOKABLE_START_MIN + 60),
    });
  });

  it("skips over conflicting bookings", () => {
    // Booked from opening for 2.5h, so the first free slot starts after it.
    const busyEnd = hhmm(BOOKABLE_START_MIN + 150);
    const bookings = [slot(local(OPEN), local(busyEnd))];
    expect(findNextFreeSlot(bookings, DATE, 60)).toEqual({
      start: busyEnd,
      end: hhmm(BOOKABLE_START_MIN + 210),
    });
  });

  it("does not offer a gap shorter than the duration", () => {
    // Opening–(+2h), then a 30-minute gap, then a long booking.
    const gapStart = hhmm(BOOKABLE_START_MIN + 120);
    const gapEnd = hhmm(BOOKABLE_START_MIN + 150);
    const secondEnd = hhmm(BOOKABLE_START_MIN + 300);
    const bookings = [slot(local(OPEN), local(gapStart)), slot(local(gapEnd), local(secondEnd))];
    // The 30-minute gap is too short for an hour, so it lands after the second booking
    expect(findNextFreeSlot(bookings, DATE, 60)).toEqual({
      start: secondEnd,
      end: hhmm(BOOKABLE_START_MIN + 360),
    });
    // ...but the gap is exactly right for 30 minutes
    expect(findNextFreeSlot(bookings, DATE, 30)).toEqual({ start: gapStart, end: gapEnd });
  });

  it("returns null when the day is fully booked", () => {
    const bookings = [slot(local(OPEN), local(CLOSE))];
    expect(findNextFreeSlot(bookings, DATE, 30)).toBeNull();
  });

  it("never offers a slot ending after bookable hours", () => {
    // Booked solid until 30 minutes before close.
    const lastGap = hhmm(BOOKABLE_END_MIN - 30);
    const bookings = [slot(local(OPEN), local(lastGap))];
    expect(findNextFreeSlot(bookings, DATE, 60)).toBeNull();
    expect(findNextFreeSlot(bookings, DATE, 30)).toEqual({ start: lastGap, end: CLOSE });
  });

  it("respects explicit hour bounds", () => {
    expect(findNextFreeSlot([], DATE, 30, 9 * 60, 10 * 60)).toEqual({
      start: "09:00",
      end: "09:30",
    });
  });
});
