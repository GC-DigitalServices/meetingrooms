import { describe, it, expect } from "vitest";
import { snapToSlot, validateDuration, isOverlongRoomBooking } from "./duration";

function mins(n: number) { return n * 60_000; }

describe("snapToSlot", () => {
  it("leaves an already-aligned time unchanged", () => {
    const d = new Date("2026-06-01T09:00:00.000Z");
    expect(snapToSlot(d).toISOString()).toBe("2026-06-01T09:00:00.000Z");
  });

  it("rounds down when less than 7.5 min past boundary", () => {
    const d = new Date("2026-06-01T09:07:00.000Z");
    expect(snapToSlot(d).toISOString()).toBe("2026-06-01T09:00:00.000Z");
  });

  it("rounds up when ≥ 7.5 min past boundary", () => {
    const d = new Date("2026-06-01T09:08:00.000Z");
    expect(snapToSlot(d).toISOString()).toBe("2026-06-01T09:15:00.000Z");
  });

  it("snaps exactly on the half-interval boundary", () => {
    const d = new Date("2026-06-01T09:07:30.000Z");
    expect(snapToSlot(d).toISOString()).toBe("2026-06-01T09:15:00.000Z");
  });
});

describe("validateDuration", () => {
  const base = new Date("2026-06-01T09:00:00.000Z");
  const at = (ms: number) => new Date(base.getTime() + ms);

  it("passes for exactly 15 minutes", () => {
    expect(() => validateDuration(base, at(mins(15)))).not.toThrow();
  });

  it("passes for exactly 8 hours", () => {
    expect(() => validateDuration(base, at(mins(480)))).not.toThrow();
  });

  it("passes for a typical 1-hour booking", () => {
    expect(() => validateDuration(base, at(mins(60)))).not.toThrow();
  });

  it("throws for a duration less than 15 minutes", () => {
    expect(() => validateDuration(base, at(mins(14)))).toThrow("at least 15 minutes");
  });

  it("throws for a duration greater than 8 hours", () => {
    expect(() => validateDuration(base, at(mins(481)))).toThrow("8 hours");
  });

  it("throws when end equals start", () => {
    expect(() => validateDuration(base, base)).toThrow();
  });

  it("throws when end is before start", () => {
    expect(() => validateDuration(base, at(-mins(30)))).toThrow();
  });
});

describe("isOverlongRoomBooking", () => {
  const base = new Date("2026-09-15T09:00:00.000Z");
  const at = (ms: number) => new Date(base.getTime() + ms);

  it("is false for a typical lesson", () => {
    expect(isOverlongRoomBooking("STANDARD", base, at(mins(60)))).toBe(false);
  });

  it("is false at exactly the 8-hour cap", () => {
    expect(isOverlongRoomBooking("STANDARD", base, at(mins(480)))).toBe(false);
  });

  it("is true one minute past the cap", () => {
    expect(isOverlongRoomBooking("STANDARD", base, at(mins(481)))).toBe(true);
  });

  it("catches a term-long Salamander block", () => {
    // The real case: one weekly lesson published as a single continuous event
    // running 14 Sep 12:35 → 14 Dec 13:35, which blocks the room for 3 months.
    const start = new Date("2026-09-14T11:35:00.000Z");
    const end = new Date("2026-12-14T13:35:00.000Z");
    expect(isOverlongRoomBooking("STANDARD", start, end)).toBe(true);
  });

  it("applies to sections and composites", () => {
    expect(isOverlongRoomBooking("SECTION", base, at(mins(600)))).toBe(true);
    expect(isOverlongRoomBooking("COMPOSITE", base, at(mins(600)))).toBe(true);
  });

  it("exempts MINIBUS, where multi-day hires are legitimate", () => {
    expect(isOverlongRoomBooking("MINIBUS", base, at(mins(3 * 24 * 60)))).toBe(false);
  });
});
