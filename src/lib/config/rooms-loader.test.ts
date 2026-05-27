import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function writeTmp(yaml: string): string {
  const p = join(tmpdir(), `mrbs-rooms-${Date.now()}-${Math.random()}.yaml`);
  writeFileSync(p, yaml, "utf-8");
  return p;
}

describe("loadRooms", () => {
  const tmpFiles: string[] = [];

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    for (const f of tmpFiles) {
      try {
        unlinkSync(f);
      } catch {}
    }
    tmpFiles.length = 0;
  });

  function tmp(yaml: string): string {
    const p = writeTmp(yaml);
    tmpFiles.push(p);
    return p;
  }

  // ---------------------------------------------------------------------------
  // Happy paths
  // ---------------------------------------------------------------------------

  it("parses a single standard room", async () => {
    const p = tmp(`
rooms:
  - id: "room1"
    mailboxUpn: "room1@example.com"
    displayName: "Room 1"
    capacity: 10
    equipment: ["projector", "whiteboard"]
    allowedGroups: []
`);
    const { loadRooms } = await import("./rooms-loader");
    const result = loadRooms(p);
    expect(result.rooms).toHaveLength(1);
    const room = result.rooms[0];
    expect(room.id).toBe("room1");
    expect(room.displayName).toBe("Room 1");
    expect(room.capacity).toBe(10);
    expect(room.equipment).toEqual(["projector", "whiteboard"]);
    expect(room.allowedGroups).toEqual([]);
  });

  it("defaults equipment and allowedGroups to empty arrays when omitted", async () => {
    const p = tmp(`
rooms:
  - id: "room1"
    mailboxUpn: "room1@example.com"
    displayName: "Room 1"
    capacity: 10
`);
    const { loadRooms } = await import("./rooms-loader");
    const result = loadRooms(p);
    const room = result.rooms[0];
    expect(room.equipment).toEqual([]);
    expect(room.allowedGroups).toEqual([]);
  });

  it("parses a composite room with its sections", async () => {
    const p = tmp(`
rooms:
  - id: "hall"
    kind: "composite"
    displayName: "Main Hall"
    capacity: 100
    equipment: []
    allowedGroups: []
    sections:
      - id: "hall-a"
        mailboxUpn: "hall-a@example.com"
        displayName: "Hall A"
        capacity: 50
        equipment: []
        allowedGroups: []
      - id: "hall-b"
        mailboxUpn: "hall-b@example.com"
        displayName: "Hall B"
        capacity: 50
        equipment: []
        allowedGroups: []
`);
    const { loadRooms } = await import("./rooms-loader");
    const result = loadRooms(p);
    expect(result.rooms).toHaveLength(1);
    const composite = result.rooms[0];
    if (composite.kind !== "composite") throw new Error("expected composite");
    expect(composite.sections).toHaveLength(2);
    expect(composite.sections[0].id).toBe("hall-a");
    expect(composite.sections[1].mailboxUpn).toBe("hall-b@example.com");
  });

  it("parses a mix of standard and composite rooms", async () => {
    const p = tmp(`
rooms:
  - id: "r1"
    mailboxUpn: "r1@example.com"
    displayName: "Room 1"
    capacity: 10
  - id: "hall"
    kind: "composite"
    displayName: "Hall"
    capacity: 60
    sections:
      - id: "hall-a"
        mailboxUpn: "hall-a@example.com"
        displayName: "Hall A"
        capacity: 30
      - id: "hall-b"
        mailboxUpn: "hall-b@example.com"
        displayName: "Hall B"
        capacity: 30
`);
    const { loadRooms } = await import("./rooms-loader");
    const result = loadRooms(p);
    expect(result.rooms).toHaveLength(2);
  });

  it("parses the real config/rooms.yaml without errors", async () => {
    const { loadRooms } = await import("./rooms-loader");
    expect(() => loadRooms()).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Validation failures
  // ---------------------------------------------------------------------------

  it("throws when the rooms list is empty", async () => {
    const p = tmp(`rooms: []`);
    const { loadRooms } = await import("./rooms-loader");
    expect(() => loadRooms(p)).toThrow("Invalid config/rooms.yaml");
  });

  it("throws when a standard room is missing mailboxUpn", async () => {
    const p = tmp(`
rooms:
  - id: "room1"
    displayName: "Room 1"
    capacity: 10
`);
    const { loadRooms } = await import("./rooms-loader");
    expect(() => loadRooms(p)).toThrow("Invalid config/rooms.yaml");
  });

  it("throws when mailboxUpn is not a valid email", async () => {
    const p = tmp(`
rooms:
  - id: "room1"
    mailboxUpn: "not-an-email"
    displayName: "Room 1"
    capacity: 10
`);
    const { loadRooms } = await import("./rooms-loader");
    expect(() => loadRooms(p)).toThrow("Invalid config/rooms.yaml");
  });

  it("throws when capacity is not a positive integer", async () => {
    const p = tmp(`
rooms:
  - id: "room1"
    mailboxUpn: "room1@example.com"
    displayName: "Room 1"
    capacity: -5
`);
    const { loadRooms } = await import("./rooms-loader");
    expect(() => loadRooms(p)).toThrow("Invalid config/rooms.yaml");
  });

  it("throws when capacity is zero", async () => {
    const p = tmp(`
rooms:
  - id: "room1"
    mailboxUpn: "room1@example.com"
    displayName: "Room 1"
    capacity: 0
`);
    const { loadRooms } = await import("./rooms-loader");
    expect(() => loadRooms(p)).toThrow("Invalid config/rooms.yaml");
  });

  it("throws when a composite room has only one section", async () => {
    const p = tmp(`
rooms:
  - id: "hall"
    kind: "composite"
    displayName: "Hall"
    capacity: 50
    sections:
      - id: "hall-a"
        mailboxUpn: "hall-a@example.com"
        displayName: "Hall A"
        capacity: 50
`);
    const { loadRooms } = await import("./rooms-loader");
    expect(() => loadRooms(p)).toThrow("at least 2 sections");
  });

  it("throws when a composite room has no sections key", async () => {
    const p = tmp(`
rooms:
  - id: "hall"
    kind: "composite"
    displayName: "Hall"
    capacity: 50
`);
    const { loadRooms } = await import("./rooms-loader");
    expect(() => loadRooms(p)).toThrow("Invalid config/rooms.yaml");
  });

  it("throws when a room id is empty", async () => {
    const p = tmp(`
rooms:
  - id: ""
    mailboxUpn: "room1@example.com"
    displayName: "Room 1"
    capacity: 10
`);
    const { loadRooms } = await import("./rooms-loader");
    expect(() => loadRooms(p)).toThrow("Invalid config/rooms.yaml");
  });
});
