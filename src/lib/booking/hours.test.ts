import { describe, it, expect } from "vitest";
import { BOOKABLE_START_MIN, BOOKABLE_END_MIN, SLOT_STEP_MIN } from "./hours";

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
