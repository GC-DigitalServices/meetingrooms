import { describe, it, expect } from "vitest";
import {
  BOOKING_HORIZON_DAYS,
  ADMIN_BOOKING_HORIZON_DAYS,
  ADMIN_LONG_HORIZON_DAYS,
  horizonDays,
  maxBookableDate,
  isWithinBookingHorizon,
} from "./horizon";

// These pin the agreed booking horizons, so a change to them is a deliberate
// edit here rather than a silent shift in how far ahead users can book.
describe("booking horizon", () => {
  it("caps ordinary users at 60 days", () => {
    expect(BOOKING_HORIZON_DAYS).toBe(60);
  });

  it("gives admins a full year on rooms", () => {
    // Must not exceed SYNC_WINDOW_DAYS (370) — beyond it the conflict check
    // cannot see externally-written timetable events.
    expect(ADMIN_BOOKING_HORIZON_DAYS).toBe(365);
  });

  it("lets admins book minibuses and visitor bays a year out", () => {
    expect(ADMIN_LONG_HORIZON_DAYS).toBe(360);
  });

  it("gives ordinary users 60 days whatever the room kind", () => {
    expect(horizonDays(false, "STANDARD")).toBe(60);
    expect(horizonDays(false, "MINIBUS")).toBe(60);
    expect(horizonDays(false, "PARKING")).toBe(60);
  });

  it("gives admins 365 days on rooms and 360 on minibus/parking", () => {
    expect(horizonDays(true, "STANDARD")).toBe(365);
    expect(horizonDays(true, "SECTION")).toBe(365);
    expect(horizonDays(true, "COMPOSITE")).toBe(365);
    expect(horizonDays(true, "MINIBUS")).toBe(360);
    expect(horizonDays(true, "PARKING")).toBe(360);
  });
});

describe("maxBookableDate", () => {
  it("adds 60 calendar days for an ordinary user", () => {
    // 2026-09-01 + 60 days = 2026-10-31
    expect(maxBookableDate(false, "STANDARD", new Date("2026-09-01T12:00:00Z"))).toBe("2026-10-31");
  });

  it("adds 365 calendar days for an admin booking a room", () => {
    expect(maxBookableDate(true, "STANDARD", new Date("2026-09-01T12:00:00Z"))).toBe("2027-09-01");
  });

  it("adds 360 calendar days for an admin booking a minibus", () => {
    expect(maxBookableDate(true, "MINIBUS", new Date("2026-09-01T12:00:00Z"))).toBe("2027-08-27");
  });

  it("counts calendar days across the autumn DST transition", () => {
    // BST→GMT is 2026-10-25. A fixed 60×24h offset from 2026-10-01 would land
    // on 2026-11-29T23:00 London and format as the 29th; calendar arithmetic
    // gives the 30th.
    expect(maxBookableDate(false, "STANDARD", new Date("2026-10-01T12:00:00Z"))).toBe("2026-11-30");
  });

  it("counts calendar days across the spring DST transition", () => {
    // GMT→BST is 2027-03-28.
    expect(maxBookableDate(false, "STANDARD", new Date("2027-02-01T12:00:00Z"))).toBe("2027-04-02");
  });

  it("resolves 'from' to its London date, not its UTC date", () => {
    // 23:30 UTC on 30 Sep is 00:30 on 1 Oct in London (BST), so the horizon
    // runs from the 1st.
    expect(maxBookableDate(false, "STANDARD", new Date("2026-09-30T23:30:00Z"))).toBe("2026-11-30");
  });
});

describe("isWithinBookingHorizon", () => {
  const from = new Date("2026-09-01T12:00:00Z"); // room horizons: 60d → 2026-10-31, 365d → 2027-09-01

  it("allows a booking on the final day", () => {
    expect(isWithinBookingHorizon(false, "STANDARD", new Date("2026-10-31T08:00:00Z"), from)).toBe(
      true,
    );
  });

  it("allows a late slot on the final day", () => {
    expect(isWithinBookingHorizon(false, "STANDARD", new Date("2026-10-31T20:30:00Z"), from)).toBe(
      true,
    );
  });

  it("rejects the day after the horizon", () => {
    expect(isWithinBookingHorizon(false, "STANDARD", new Date("2026-11-01T08:00:00Z"), from)).toBe(
      false,
    );
  });

  it("allows an admin past the ordinary horizon on a room", () => {
    expect(isWithinBookingHorizon(true, "STANDARD", new Date("2027-06-15T08:00:00Z"), from)).toBe(
      true,
    );
  });

  it("allows an admin the last day of the year on a room", () => {
    expect(isWithinBookingHorizon(true, "STANDARD", new Date("2027-09-01T08:00:00Z"), from)).toBe(
      true,
    );
  });

  it("rejects an admin past a year out on a room", () => {
    expect(isWithinBookingHorizon(true, "STANDARD", new Date("2027-09-02T08:00:00Z"), from)).toBe(
      false,
    );
  });

  it("allows an admin a visitor bay nearly a year out", () => {
    expect(isWithinBookingHorizon(true, "PARKING", new Date("2027-08-27T08:00:00Z"), from)).toBe(
      true,
    );
  });

  it("rejects an admin past a year out on a minibus", () => {
    expect(isWithinBookingHorizon(true, "MINIBUS", new Date("2027-08-28T08:00:00Z"), from)).toBe(
      false,
    );
  });

  it("holds ordinary users to 60 days on a minibus too", () => {
    expect(isWithinBookingHorizon(false, "MINIBUS", new Date("2026-11-01T08:00:00Z"), from)).toBe(
      false,
    );
  });

  it("allows today and dates already in range", () => {
    expect(isWithinBookingHorizon(false, "STANDARD", new Date("2026-09-01T09:00:00Z"), from)).toBe(
      true,
    );
    expect(isWithinBookingHorizon(false, "STANDARD", new Date("2026-09-15T09:00:00Z"), from)).toBe(
      true,
    );
  });
});
