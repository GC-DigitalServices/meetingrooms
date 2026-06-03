import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "http";
import { loadSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { canSeeRoom, bookingDetailVisibility } from "@/lib/booking/visibility";
import { logger } from "@/lib/logger";
import { getConfig } from "@/lib/config";
import crypto from "crypto";
import type { Booking } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PortalClientData {
  type: "portal";
  upn: string;
  isStaff: boolean;
  isAdmin: boolean;
  subscribedRooms: Set<string>;
}

export interface DeviceClientData {
  type: "device";
  deviceId: string;
  roomId: string;
  /** Set for SECTION-scope devices: the composite parent's room ID. */
  parentCompositeId?: string;
  scope: "STANDARD" | "SECTION" | "COMPOSITE";
}

export type ClientData = PortalClientData | DeviceClientData;

export interface RealtimeEnvelope {
  id: string;
  type: string;
  at: string;
  payload: unknown;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let io: SocketIOServer | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;

export function getSocketServer(): SocketIOServer {
  if (!io) throw new Error("Socket server not initialized");
  return io;
}

/** Tears down the server and clears the singleton. Used in tests. */
/**
 * Disconnect all active sockets for a given device ID.
 * Called when an admin revokes a device. No-op if the socket server isn't running.
 */
export function disconnectDevice(deviceId: string): void {
  if (!io) return;
  io.sockets.sockets.forEach((socket) => {
    const data = socket.data as ClientData;
    if (data.type === "device" && data.deviceId === deviceId) {
      socket.disconnect(true);
    }
  });
}

export function destroySocketServer(): Promise<void> {
  return new Promise((resolve) => {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (io) {
      io.close(() => {
        io = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export function makeEnvelope(type: string, payload: unknown): RealtimeEnvelope {
  return { id: crypto.randomUUID(), type, at: new Date().toISOString(), payload };
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

export function serializeBookingFull(b: Booking) {
  return {
    id: b.id,
    roomId: b.roomId,
    organiserUpn: b.organiserUpn,
    organiserName: b.organiserName,
    subject: b.subject,
    startUtc: b.startUtc.toISOString(),
    endUtc: b.endUtc.toISOString(),
    isAllDay: b.isAllDay,
    source: b.source,
    visibility: "full" as const,
  };
}

export function serializeBookingBusy(b: Booking) {
  return {
    id: b.id,
    roomId: b.roomId,
    startUtc: b.startUtc.toISOString(),
    endUtc: b.endUtc.toISOString(),
    isAllDay: b.isAllDay,
    visibility: "busy" as const,
  };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function parseCookieHeader(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const match = header.match(new RegExp(`(?:^|;\\s*)${encodeURIComponent(name)}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

async function authenticatePortal(cookieHeader: string | undefined): Promise<PortalClientData> {
  const sessionId = parseCookieHeader(cookieHeader, "session");
  if (!sessionId) throw new Error("no session cookie");

  const session = await loadSession(sessionId);
  if (!session) throw new Error("session expired or invalid");

  return {
    type: "portal",
    upn: session.upn,
    isStaff: session.isStaff,
    isAdmin: session.isAdmin,
    subscribedRooms: new Set(),
  };
}

async function authenticateDevice(token: string): Promise<DeviceClientData> {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const device = await db.device.findFirst({
    where: { tokenHash },
    include: { room: true },
  });
  if (!device) throw new Error("unknown device token");

  return {
    type: "device",
    deviceId: device.id,
    roomId: device.room.id,
    parentCompositeId:
      device.scope === "SECTION" && device.room.parentRoomId
        ? device.room.parentRoomId
        : undefined,
    scope: device.scope,
  };
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export async function computeSnapshot(
  roomId: string,
  viewer: ClientData
): Promise<RealtimeEnvelope> {
  const now = new Date();
  const until = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const bookings = await db.booking.findMany({
    where: { roomId, startUtc: { lt: until }, endUtc: { gt: now } },
    orderBy: { startUtc: "asc" },
  });

  let items: unknown[];

  if (viewer.type === "device") {
    // Devices are trusted system components; they see full detail.
    items = bookings.map(serializeBookingFull);
  } else {
    const upns = [...new Set(bookings.map((b) => b.organiserUpn))];
    const users = await db.user.findMany({
      where: { upn: { in: upns } },
      select: { upn: true, isStaff: true },
    });
    const staffMap = new Map(users.map((u) => [u.upn, u.isStaff]));

    items = bookings.map((b) => {
      const organiserIsStaff = staffMap.get(b.organiserUpn) ?? false;
      const vis = bookingDetailVisibility(
        { upn: viewer.upn, isStaff: viewer.isStaff, isAdmin: viewer.isAdmin },
        { organiserUpn: b.organiserUpn, organiserIsStaff }
      );
      return vis === "full" ? serializeBookingFull(b) : serializeBookingBusy(b);
    });
  }

  return makeEnvelope("snapshot", { roomId, bookings: items });
}

// ---------------------------------------------------------------------------
// Portal message handlers (internal)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSubscribe(socket: any, rawIds: unknown[], clientData: PortalClientData) {
  const ids = rawIds.filter((id): id is string => typeof id === "string");
  const available = 50 - clientData.subscribedRooms.size;
  const toAdd = ids.slice(0, available);
  if (toAdd.length === 0) return;

  const rooms = await db.room.findMany({
    where: { id: { in: toAdd } },
    select: { id: true, bookable: true },
  });

  for (const room of rooms) {
    if (!canSeeRoom({ isStaff: clientData.isStaff, isAdmin: clientData.isAdmin }, room)) {
      logger.warn(
        { upn: clientData.upn, roomId: room.id },
        "ws: subscribe rejected (room not visible)"
      );
      continue;
    }
    socket.join(`room:${room.id}`);
    clientData.subscribedRooms.add(room.id);

    try {
      const snapshot = await computeSnapshot(room.id, clientData);
      socket.emit("message", snapshot);
      logger.info({ upn: clientData.upn, roomId: room.id }, "ws: ws_messages_out snapshot");
    } catch (err) {
      logger.error({ err, roomId: room.id }, "ws: snapshot failed");
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleUnsubscribe(socket: any, rawIds: unknown[], clientData: PortalClientData) {
  for (const id of rawIds) {
    if (typeof id !== "string") continue;
    socket.leave(`room:${id}`);
    clientData.subscribedRooms.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  if (io) return io;

  const { PUBLIC_BASE_URL } = getConfig();

  io = new SocketIOServer(httpServer, {
    path: "/ws",
    cors: { origin: PUBLIC_BASE_URL, credentials: true },
    transports: ["websocket", "polling"],
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  // Auth middleware — reject unauthenticated handshakes.
  io.use(async (socket, next) => {
    try {
      const cookie = socket.handshake.headers.cookie;
      const authToken = socket.handshake.auth?.token as string | undefined;

      socket.data = authToken
        ? await authenticateDevice(authToken)
        : await authenticatePortal(cookie);

      next();
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown";
      logger.warn({ ip: socket.handshake.address, reason }, "ws: ws_auth_failure");
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", async (socket) => {
    const clientData = socket.data as ClientData;
    logger.info({ type: clientData.type, socketId: socket.id }, "ws: ws_connected");

    if (clientData.type === "device") {
      socket.join(`room:${clientData.roomId}`);

      const snapshotRooms: string[] = [clientData.roomId];

      if (clientData.scope === "SECTION" && clientData.parentCompositeId) {
        socket.join(`room:${clientData.parentCompositeId}`);
      } else if (clientData.scope === "COMPOSITE") {
        const sections = await db.room.findMany({
          where: { parentRoomId: clientData.roomId },
          select: { id: true },
        });
        for (const s of sections) {
          socket.join(`room:${s.id}`);
          // COMPOSITE display needs a per-section snapshot to render status cards
          snapshotRooms.push(s.id);
        }
      }

      for (const roomId of snapshotRooms) {
        try {
          socket.emit("message", await computeSnapshot(roomId, clientData));
        } catch (err) {
          logger.error({ err, roomId }, "ws: device snapshot failed");
        }
      }

      // Heartbeat handler — update lastSeenAt in the background
      socket.on("message", (msg: unknown) => {
        if (
          msg &&
          typeof msg === "object" &&
          (msg as { type?: string }).type === "heartbeat"
        ) {
          db.device
            .update({
              where: { id: (clientData as DeviceClientData).deviceId },
              data: { lastSeenAt: new Date() },
            })
            .catch(() => {});
        }
      });
    } else {
      socket.on("message", async (msg: unknown) => {
        logger.info(
          { socketId: socket.id, msgType: (msg as Record<string, unknown>)?.type },
          "ws: ws_messages_in"
        );
        try {
          if (!msg || typeof msg !== "object") return;
          const m = msg as { type?: string; roomIds?: unknown };
          if (m.type === "subscribe" && Array.isArray(m.roomIds)) {
            await handleSubscribe(socket, m.roomIds, clientData as PortalClientData);
          } else if (m.type === "unsubscribe" && Array.isArray(m.roomIds)) {
            await handleUnsubscribe(socket, m.roomIds, clientData as PortalClientData);
          }
        } catch (err) {
          logger.error({ err }, "ws: message handler error");
        }
      });
    }

    socket.on("disconnect", (reason) => {
      logger.info({ socketId: socket.id, reason }, "ws: disconnected");
    });
  });

  // App-level ping so clients can detect a dead connection even if no booking
  // events are flowing. Complements Socket.IO's protocol-level ping/pong.
  pingTimer = setInterval(() => {
    io!.emit("message", makeEnvelope("ping", {}));
  }, 25000);

  return io;
}
