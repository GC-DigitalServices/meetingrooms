import { describe, it, expect } from "vitest";
import {
  BOOKABLE_START_MIN,
  BOOKABLE_END_MIN,
  SLOT_STEP_MIN,
  isWithinBookableHours,
} from "./hours";

// labels.test.ts derives its fixtures from these constants so it tests
// slot-finding logic rather than policy — which leaves nothing asserting the
// window itself. These pin the agreed opening hours, so a change to them is a
// deliberate edit here rather than a silent shift in what users can book.

describe("bookable hours", () => {
  it("opens at 07:00", () => {
    expect(BOOKABLE_START_MIN).toBe(7 * 60);
  });

  it("closes at 21:00", () => {
    expect(BOOKABLE_END_MIN).toBe(21 * 60);
  });

  it("spans a whole number of slots", () => {
    expect((BOOKABLE_END_MIN - BOOKABLE_START_MIN) % SLOT_STEP_MIN).toBe(0);
  });

  it("opens before it closes", () => {
    expect(BOOKABLE_START_MIN).toBeLessThan(BOOKABLE_END_MIN);
  });
});

describe("isWithinBookableHours", () => {
  // Window is 07:00–21:00 London. Dates below are UTC: summer London = UTC+1,
  // winter London = UTC+0. This proves the check is London-aware (DST-safe).
  it("accepts a booking inside hours (winter / GMT)", () => {
    expect(
      isWithinBookableHours("STANDARD", new Date("2026-01-06T09:00:00Z"), new Date("2026-01-06T10:00:00Z")),
    ).toBe(true);
  });

  it("accepts the exact 07:00 and 21:00 boundaries (summer / BST)", () => {
    // 07:00 BST = 06:00Z, 21:00 BST = 20:00Z
    expect(
      isWithinBookableHours("STANDARD", new Date("2026-08-06T06:00:00Z"), new Date("2026-08-06T20:00:00Z")),
    ).toBe(true);
  });

  it("rejects a start before 07:00 London", () => {
    // 06:45 BST = 05:45Z
    expect(
      isWithinBookableHours("STANDARD", new Date("2026-08-06T05:45:00Z"), new Date("2026-08-06T07:00:00Z")),
    ).toBe(false);
  });

  it("rejects an end after 21:00 London", () => {
    // 21:15 BST = 20:15Z
    expect(
      isWithinBookableHours("STANDARD", new Date("2026-08-06T19:00:00Z"), new Date("2026-08-06T20:15:00Z")),
    ).toBe(false);
  });

  it("rejects a booking spanning two London days", () => {
    expect(
      isWithinBookableHours("STANDARD", new Date("2026-08-06T19:00:00Z"), new Date("2026-08-07T06:00:00Z")),
    ).toBe(false);
  });

  it("exempts MINIBUS (multi-day / overnight hires)", () => {
    expect(
      isWithinBookableHours("MINIBUS", new Date("2026-08-06T02:00:00Z"), new Date("2026-08-08T02:00:00Z")),
    ).toBe(true);
  });
});
