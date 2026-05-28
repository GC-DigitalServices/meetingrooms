import { describe, it, expect, vi } from "vitest";

// Prevent module-level db/graphClient initialisations from failing in tests.
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/graph/client");

import { resolveLogicalRoomId } from "@/lib/graph/sync";

// Fixture: composite "comp1" has sections "s1" and "s2"; "std1" is standalone.
const mailboxToRoomId = new Map([
  ["s1@rooms.example.com", "s1"],
  ["s2@rooms.example.com", "s2"],
  ["std1@rooms.example.com", "std1"],
]);
const sectionToParentId = new Map([
  ["s1", "comp1"],
  ["s2", "comp1"],
]);

describe("resolveLogicalRoomId", () => {
  it("returns fallbackRoomId when no attendees are present", () => {
    expect(resolveLogicalRoomId([], mailboxToRoomId, sectionToParentId, "fallback")).toBe("fallback");
  });

  it("returns fallbackRoomId when no attendees match known mailboxes", () => {
    expect(
      resolveLogicalRoomId(["unknown@rooms.example.com"], mailboxToRoomId, sectionToParentId, "fallback")
    ).toBe("fallback");
  });

  it("returns the section id when one section is invited", () => {
    expect(
      resolveLogicalRoomId(["s1@rooms.example.com"], mailboxToRoomId, sectionToParentId, "fallback")
    ).toBe("s1");
  });

  it("returns the standard room id when a standalone room is invited", () => {
    expect(
      resolveLogicalRoomId(["std1@rooms.example.com"], mailboxToRoomId, sectionToParentId, "fallback")
    ).toBe("std1");
  });

  it("normalises UPN casing before lookup", () => {
    expect(
      resolveLogicalRoomId(["S1@ROOMS.EXAMPLE.COM"], mailboxToRoomId, sectionToParentId, "fallback")
    ).toBe("s1");
  });

  it("returns the composite id when all sections of the composite are invited", () => {
    expect(
      resolveLogicalRoomId(
        ["s1@rooms.example.com", "s2@rooms.example.com"],
        mailboxToRoomId,
        sectionToParentId,
        "fallback"
      )
    ).toBe("comp1");
  });

  it("returns the composite id when sections arrive in mixed case", () => {
    expect(
      resolveLogicalRoomId(
        ["S1@rooms.example.com", "s2@ROOMS.EXAMPLE.COM"],
        mailboxToRoomId,
        sectionToParentId,
        "fallback"
      )
    ).toBe("comp1");
  });

  it("returns fallbackRoomId when sections belong to different composites", () => {
    const twoComposites = new Map([["s1", "comp1"], ["s2", "comp2"]]);
    expect(
      resolveLogicalRoomId(
        ["s1@rooms.example.com", "s2@rooms.example.com"],
        mailboxToRoomId,
        twoComposites,
        "fallback"
      )
    ).toBe("fallback");
  });

  it("returns fallbackRoomId when a section and an unrelated standard room are both invited", () => {
    // s1 resolves to parent comp1; std1 has no parent so resolves to itself — two different roots.
    expect(
      resolveLogicalRoomId(
        ["s1@rooms.example.com", "std1@rooms.example.com"],
        mailboxToRoomId,
        sectionToParentId,
        "fallback"
      )
    ).toBe("fallback");
  });

  it("handles three sections all sharing the same composite", () => {
    const extended = new Map([...mailboxToRoomId, ["s3@rooms.example.com", "s3"]]);
    const extendedParents = new Map([...sectionToParentId, ["s3", "comp1"]]);
    expect(
      resolveLogicalRoomId(
        ["s1@rooms.example.com", "s2@rooms.example.com", "s3@rooms.example.com"],
        extended,
        extendedParents,
        "fallback"
      )
    ).toBe("comp1");
  });
});
