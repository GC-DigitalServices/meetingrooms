import { describe, it, expect } from "vitest";
import { freeUntilLabel, busyUntilLabel, bookedAtLabel, findNextFreeSlot } from "./labels";

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
    expect(findNextFreeSlot([], DATE, 60)).toEqual({ start: "08:00", end: "09:00" });
  });

  it("skips over conflicting bookings", () => {
    const bookings = [slot(local("08:00"), local("09:30"))];
    expect(findNextFreeSlot(bookings, DATE, 60)).toEqual({ start: "09:30", end: "10:30" });
  });

  it("does not offer a gap shorter than the duration", () => {
    const bookings = [slot(local("08:00"), local("09:00")), slot(local("09:30"), local("12:00"))];
    // 09:00–09:30 gap is too short for an hour
    expect(findNextFreeSlot(bookings, DATE, 60)).toEqual({ start: "12:00", end: "13:00" });
    // ...but fine for 30 minutes
    expect(findNextFreeSlot(bookings, DATE, 30)).toEqual({ start: "09:00", end: "09:30" });
  });

  it("returns null when the day is fully booked", () => {
    const bookings = [slot(local("07:00"), local("21:00"))];
    expect(findNextFreeSlot(bookings, DATE, 30)).toBeNull();
  });

  it("never offers a slot ending after bookable hours", () => {
    const bookings = [slot(local("08:00"), local("19:30"))];
    // 19:30–20:00 is the only gap; an hour doesn't fit
    expect(findNextFreeSlot(bookings, DATE, 60)).toBeNull();
    expect(findNextFreeSlot(bookings, DATE, 30)).toEqual({ start: "19:30", end: "20:00" });
  });

  it("respects explicit hour bounds", () => {
    expect(findNextFreeSlot([], DATE, 30, 9 * 60, 10 * 60)).toEqual({
      start: "09:00",
      end: "09:30",
    });
  });
});
