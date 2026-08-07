import { describe, it, expect } from "vitest";
import { londonToUtc, addLondonWeeks, localTime } from "./utils";

// UK DST in 2026: clocks go forward 2026-03-29, back 2026-10-25.
// These assertions are independent of the machine timezone (all conversions
// pin Europe/London explicitly).

describe("londonToUtc", () => {
  it("treats a winter (GMT) wall-clock as UTC+0", () => {
    expect(londonToUtc("2026-01-06", "09:00").toISOString()).toBe("2026-01-06T09:00:00.000Z");
  });

  it("treats a summer (BST) wall-clock as UTC+1", () => {
    expect(londonToUtc("2026-08-06", "09:00").toISOString()).toBe("2026-08-06T08:00:00.000Z");
  });

  it("handles an early-hours time that wraps the UTC day in summer", () => {
    // 00:15 BST is 23:15 UTC the previous day
    expect(londonToUtc("2026-08-06", "00:15").toISOString()).toBe("2026-08-05T23:15:00.000Z");
  });
});

describe("addLondonWeeks", () => {
  const winterStart = new Date("2026-03-01T09:00:00Z"); // 09:00 London (GMT)

  it("is a no-op for week 0", () => {
    expect(addLondonWeeks(winterStart, 0).toISOString()).toBe("2026-03-01T09:00:00.000Z");
  });

  it("keeps the London wall-clock time when crossing into BST", () => {
    // +5 weeks = 2026-04-05, now in BST → 09:00 London is 08:00 UTC
    const result = addLondonWeeks(winterStart, 5);
    expect(result.toISOString()).toBe("2026-04-05T08:00:00.000Z");
    expect(localTime(result)).toBe("09:00"); // wall-clock preserved, not drifted
  });
});
