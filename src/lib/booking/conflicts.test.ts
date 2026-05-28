import { describe, it, expect } from "vitest";
import { overlaps, findConflict } from "./conflicts";

function range(startH: number, endH: number) {
  const base = new Date("2026-06-01T00:00:00Z").getTime();
  return {
    startUtc: new Date(base + startH * 3600_000),
    endUtc:   new Date(base + endH   * 3600_000),
  };
}

describe("overlaps", () => {
  it("returns true for fully overlapping ranges", () => {
    expect(overlaps(range(9, 11), range(9, 11))).toBe(true);
  });

  it("returns true when proposed starts during existing", () => {
    expect(overlaps(range(10, 12), range(9, 11))).toBe(true);
  });

  it("returns true when proposed ends during existing", () => {
    expect(overlaps(range(8, 10), range(9, 11))).toBe(true);
  });

  it("returns true when proposed contains existing", () => {
    expect(overlaps(range(8, 12), range(9, 11))).toBe(true);
  });

  it("returns false when proposed ends exactly when existing starts (adjacent)", () => {
    expect(overlaps(range(8, 9), range(9, 11))).toBe(false);
  });

  it("returns false when proposed starts exactly when existing ends (adjacent)", () => {
    expect(overlaps(range(11, 12), range(9, 11))).toBe(false);
  });

  it("returns false for completely non-overlapping ranges", () => {
    expect(overlaps(range(13, 14), range(9, 11))).toBe(false);
  });
});

describe("findConflict", () => {
  const bookings = [range(9, 10), range(11, 12), range(14, 15)];

  it("returns undefined when no conflict", () => {
    expect(findConflict(range(10, 11), bookings)).toBeUndefined();
  });

  it("returns the conflicting booking", () => {
    expect(findConflict(range(9, 10), bookings)).toEqual(bookings[0]);
  });

  it("returns first conflict when multiple overlap", () => {
    expect(findConflict(range(9, 12), bookings)).toEqual(bookings[0]);
  });

  it("returns undefined for empty existing list", () => {
    expect(findConflict(range(9, 10), [])).toBeUndefined();
  });
});
