import { describe, it, expect } from "vitest";
import { canUserBookRoom, wouldPassWithoutAdmin } from "./permissions";
import { NotPermittedError, RoomNotBookableError } from "./errors";

const openRoom    = { bookable: true,  allowedGroups: [] };
const closedRoom  = { bookable: false, allowedGroups: [] };
const staffRoom   = { bookable: true,  allowedGroups: ["staff-uuid"] };

const student = { isAdmin: false, groupIds: [] };
const staff   = { isAdmin: false, groupIds: ["staff-uuid"] };
const admin   = { isAdmin: true,  groupIds: [] };

describe("canUserBookRoom", () => {
  it("returns true for any user on an open room", () => {
    expect(canUserBookRoom(student, openRoom)).toBe(true);
  });

  it("throws RoomNotBookableError when room.bookable is false", () => {
    expect(() => canUserBookRoom(student, closedRoom)).toThrow(RoomNotBookableError);
  });

  it("throws NotPermittedError when student lacks required group", () => {
    expect(() => canUserBookRoom(student, staffRoom)).toThrow(NotPermittedError);
  });

  it("returns true when user is in an allowed group", () => {
    expect(canUserBookRoom(staff, staffRoom)).toBe(true);
  });

  it("admin always returns true regardless of allowedGroups", () => {
    expect(canUserBookRoom(admin, staffRoom)).toBe(true);
  });

  it("admin bypasses non-bookable check", () => {
    expect(canUserBookRoom(admin, closedRoom)).toBe(true);
  });

  it("returns true when user is in one of multiple allowed groups", () => {
    const room = { bookable: true, allowedGroups: ["other-uuid", "staff-uuid"] };
    expect(canUserBookRoom(staff, room)).toBe(true);
  });

  it("throws when user's groups do not intersect allowedGroups", () => {
    const room = { bookable: true, allowedGroups: ["other-uuid"] };
    expect(() => canUserBookRoom(staff, room)).toThrow(NotPermittedError);
  });
});

describe("wouldPassWithoutAdmin", () => {
  it("returns true for open room", () => {
    expect(wouldPassWithoutAdmin(admin, openRoom)).toBe(true);
  });

  it("returns false for non-bookable room", () => {
    expect(wouldPassWithoutAdmin(admin, closedRoom)).toBe(false);
  });

  it("returns false when no group intersection", () => {
    expect(wouldPassWithoutAdmin(admin, staffRoom)).toBe(false);
  });

  it("returns true when group intersects even for an admin user", () => {
    const adminInGroup = { isAdmin: true, groupIds: ["staff-uuid"] };
    expect(wouldPassWithoutAdmin(adminInGroup, staffRoom)).toBe(true);
  });
});
