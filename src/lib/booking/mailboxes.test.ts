import { describe, it, expect } from "vitest";
import { resolveBookingMailboxes, bookingLockKey } from "./mailboxes";

const std    = { id: "std1", kind: "STANDARD",  mailboxUpn: "std1@rooms.example.com" };
const minibus = { id: "mb1",  kind: "MINIBUS",   mailboxUpn: "mb1@rooms.example.com" };
const comp    = { id: "comp1", kind: "COMPOSITE", mailboxUpn: null };
const sec1    = { id: "s1",   kind: "SECTION",   mailboxUpn: "s1@rooms.example.com" };
const sec2    = { id: "s2",   kind: "SECTION",   mailboxUpn: "s2@rooms.example.com" };
const secNull = { id: "s3",   kind: "SECTION",   mailboxUpn: null };

describe("resolveBookingMailboxes", () => {
  it("returns the single mailbox for a standard room", () => {
    expect(resolveBookingMailboxes(std, [])).toEqual(["std1@rooms.example.com"]);
  });

  it("returns the single mailbox for a minibus room", () => {
    expect(resolveBookingMailboxes(minibus, [])).toEqual(["mb1@rooms.example.com"]);
  });

  it("returns all section mailboxes for a composite room", () => {
    expect(resolveBookingMailboxes(comp, [sec1, sec2])).toEqual([
      "s1@rooms.example.com",
      "s2@rooms.example.com",
    ]);
  });

  it("filters out null mailboxes from section list", () => {
    expect(resolveBookingMailboxes(comp, [sec1, secNull])).toEqual([
      "s1@rooms.example.com",
    ]);
  });

  it("throws when composite has no section mailboxes", () => {
    expect(() => resolveBookingMailboxes(comp, [])).toThrow("no calendar mailboxes configured");
  });

  it("throws when standard room has no mailboxUpn", () => {
    const noMbox = { id: "x", kind: "STANDARD", mailboxUpn: null };
    expect(() => resolveBookingMailboxes(noMbox, [])).toThrow("does not have a calendar mailbox");
  });
});

describe("bookingLockKey", () => {
  it("locks on room id for STANDARD rooms", () => {
    expect(bookingLockKey("std1", "STANDARD", null)).toBe("lock:room:std1");
  });

  it("locks on room id for MINIBUS rooms", () => {
    expect(bookingLockKey("mb1", "MINIBUS", null)).toBe("lock:room:mb1");
  });

  it("locks on room id for COMPOSITE rooms", () => {
    expect(bookingLockKey("comp1", "COMPOSITE", null)).toBe("lock:room:comp1");
  });

  it("locks on parentRoomId for SECTION rooms", () => {
    expect(bookingLockKey("s1", "SECTION", "comp1")).toBe("lock:room:comp1");
  });

  it("falls back to own id for SECTION with no parent", () => {
    expect(bookingLockKey("s1", "SECTION", null)).toBe("lock:room:s1");
  });

  it("locks on parentRoomId for PARKING_BAY rooms", () => {
    expect(bookingLockKey("bay1", "PARKING_BAY", "pool1")).toBe("lock:room:pool1");
  });
});
