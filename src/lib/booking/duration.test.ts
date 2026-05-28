import { describe, it, expect } from "vitest";
import { snapToSlot, validateDuration } from "./duration";

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
