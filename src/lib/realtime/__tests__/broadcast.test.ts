import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer } from "http";
import type { AddressInfo } from "net";
import { io as socketClient, type Socket as ClientSocket } from "socket.io-client";

// ---------------------------------------------------------------------------
// Module mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth/session", () => ({
  loadSession: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  db: {
    device: { findFirst: vi.fn(), findUnique: vi.fn() },
    room: { findMany: vi.fn() },
    booking: { findMany: vi.fn() },
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/config", () => ({
  getConfig: () => ({ PUBLIC_BASE_URL: "http://localhost" }),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { loadSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import {
  initSocketServer,
  destroySocketServer,
  makeEnvelope,
  serializeBookingFull,
  serializeBookingBusy,
} from "../socket";
import { publishBookingCreated, publishBookingDeleted } from "../publish";
import type { Booking } from "@prisma/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SESSION = {
  upn: "staff@school.ac.uk",
  displayName: "Staff User",
  isStaff: true,
  isAdmin: false,
  groupIds: [],
  termsAccepted: true,
  signedInAt: Date.now(),
  lastActiveAt: Date.now(),
};

const TEST_BOOKING: Booking = {
  id: "bk_001",
  graphEventId: "graph_001",
  graphICalUid: "ical_001",
  roomId: "room_A",
  organiserUpn: "staff@school.ac.uk",
  organiserName: "Staff User",
  subject: "Year 10 Physics",
  startUtc: new Date("2025-06-01T09:00:00Z"),
  endUtc: new Date("2025-06-01T10:00:00Z"),
  isAllDay: false,
  source: "PORTAL",
  lastSyncedAt: new Date(),
  createdAt: new Date(),
  premisesNotes: null,
  premisesNotifyHash: null,
  primaryMailboxUpn: "room-a@school.ac.uk",
  recurringGroupId: null,
};

// ---------------------------------------------------------------------------
// Unit: makeEnvelope
// ---------------------------------------------------------------------------

describe("makeEnvelope", () => {
  it("generates a unique id, correct type, and ISO timestamp", () => {
    const a = makeEnvelope("booking.created", { x: 1 });
    const b = makeEnvelope("booking.created", { x: 1 });

    expect(a.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(a.id).not.toBe(b.id);
    expect(a.type).toBe("booking.created");
    expect(() => new Date(a.at)).not.toThrow();
    expect(a.payload).toEqual({ x: 1 });
  });
});

// ---------------------------------------------------------------------------
// Unit: serialisation
// ---------------------------------------------------------------------------

describe("serializeBookingFull / serializeBookingBusy", () => {
  it("full includes subject and organiser", () => {
    const s = serializeBookingFull(TEST_BOOKING);
    expect(s.visibility).toBe("full");
    expect(s.subject).toBe("Year 10 Physics");
    expect(s.organiserUpn).toBe("staff@school.ac.uk");
  });

  it("busy strips subject and organiser", () => {
    const s = serializeBookingBusy(TEST_BOOKING);
    expect(s.visibility).toBe("busy");
    expect((s as Record<string, unknown>).subject).toBeUndefined();
    expect((s as Record<string, unknown>).organiserUpn).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Integration: booking.created delivered within 2 s
// ---------------------------------------------------------------------------

describe("publishBookingCreated → socket delivery", () => {
  let serverUrl: string;
  let client: ClientSocket;
  let httpServer: ReturnType<typeof createServer>;

  beforeEach(async () => {
    // Set up mocks
    vi.mocked(loadSession).mockResolvedValue(TEST_SESSION);
    vi.mocked(db.device.findFirst).mockResolvedValue(null);
    vi.mocked(db.room.findMany).mockResolvedValue([
      { id: "room_A", bookable: true } as never,
    ]);
    vi.mocked(db.booking.findMany).mockResolvedValue([]);
    vi.mocked(db.user.findMany).mockResolvedValue([]);
    vi.mocked(db.user.findUnique).mockResolvedValue({ isStaff: true } as never);

    // Start a real HTTP + Socket.IO server on a random port
    httpServer = createServer();
    initSocketServer(httpServer);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    serverUrl = `http://localhost:${port}`;
  });

  afterEach(async () => {
    client?.close();
    await destroySocketServer();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("delivers booking.created to a subscribed portal client within 2 s", async () => {
    client = socketClient(serverUrl, {
      path: "/ws",
      transports: ["websocket"],
      extraHeaders: { cookie: "session=test-session-id" },
    });

    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });

    // Subscribe to the room
    client.emit("message", { type: "subscribe", roomIds: ["room_A"] });

    // Wait for the snapshot to arrive (subscribe triggers a snapshot)
    await new Promise<void>((resolve) => {
      client.once("message", () => resolve());
    });

    // Now publish a booking.created and assert receipt within 2 s
    const received = new Promise<{ type: string; payload: unknown }>((resolve) => {
      client.on("message", (msg: { type: string; payload: unknown }) => {
        if (msg.type === "booking.created") resolve(msg);
      });
    });

    await publishBookingCreated(TEST_BOOKING);

    const msg = await Promise.race([
      received,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout: no booking.created within 2 s")), 2000)
      ),
    ]);

    expect(msg.type).toBe("booking.created");
    const booking = (msg.payload as { booking: { id: string; visibility: string } }).booking;
    expect(booking.id).toBe("bk_001");
    expect(booking.visibility).toBe("full"); // staff viewer + staff organiser
  });

  it("publishBookingDeleted fans out to both section and composite channels", async () => {
    // Two clients: one subscribed to the section, one to the composite
    let client2!: ClientSocket;

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        client = socketClient(serverUrl, {
          path: "/ws",
          transports: ["websocket"],
          extraHeaders: { cookie: "session=test-session-id" },
        });
        client.once("connect", resolve);
        client.once("connect_error", reject);
      }),
      new Promise<void>((resolve, reject) => {
        client2 = socketClient(serverUrl, {
          path: "/ws",
          transports: ["websocket"],
          extraHeaders: { cookie: "session=test-session-id" },
        });
        client2.once("connect", resolve);
        client2.once("connect_error", reject);
      }),
    ]);

    // Mock rooms so that room_section is bookable and room_composite is bookable
    vi.mocked(db.room.findMany).mockImplementation(
      (async (args: { where?: { id?: { in?: string[] } } }) => {
        const ids = args?.where?.id?.in ?? [];
        return ids.map((id) => ({ id, bookable: true }));
      }) as unknown as typeof db.room.findMany,
    );

    client.emit("message", { type: "subscribe", roomIds: ["room_section"] });
    client2.emit("message", { type: "subscribe", roomIds: ["room_composite"] });

    // Wait for both snapshots
    await Promise.all([
      new Promise<void>((r) => client.once("message", () => r())),
      new Promise<void>((r) => client2.once("message", () => r())),
    ]);

    const deletedOnSection = new Promise<void>((resolve) => {
      client.on("message", (msg: { type: string }) => {
        if (msg.type === "booking.deleted") resolve();
      });
    });
    const deletedOnComposite = new Promise<void>((resolve) => {
      client2.on("message", (msg: { type: string }) => {
        if (msg.type === "booking.deleted") resolve();
      });
    });

    await publishBookingDeleted("room_section", "bk_002", "room_composite");

    await Promise.race([
      Promise.all([deletedOnSection, deletedOnComposite]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout: fan-out not received within 2 s")), 2000)
      ),
    ]);

    client2!.close();
  });
});
