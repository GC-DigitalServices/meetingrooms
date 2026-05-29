import {
  getSocketServer,
  makeEnvelope,
  serializeBookingFull,
  serializeBookingBusy,
  type ClientData,
} from "@/lib/realtime/socket";
import { bookingDetailVisibility } from "@/lib/booking/visibility";
import { db } from "@/lib/db/client";
import { logger } from "@/lib/logger";
import type { Booking, Room } from "@prisma/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getChannels(roomId: string, parentId?: string | null): string[] {
  const chs = [`room:${roomId}`];
  if (parentId) chs.push(`room:${parentId}`);
  return chs;
}

async function broadcastBooking(
  type: "booking.created" | "booking.updated",
  booking: Booking,
  parentId?: string | null
): Promise<void> {
  let io: ReturnType<typeof getSocketServer>;
  try {
    io = getSocketServer();
  } catch {
    return; // Server not initialised (e.g. in unit tests)
  }

  // Resolve the organiser's staff status once for all subscribers.
  const organiserUser = await db.user
    .findUnique({ where: { upn: booking.organiserUpn }, select: { isStaff: true } })
    .catch(() => null);
  const organiserIsStaff = organiserUser?.isStaff ?? false;

  const channels = getChannels(booking.roomId, parentId);

  for (const channel of channels) {
    const sockets = await io.in(channel).fetchSockets();
    logger.info({ type, channel, recipients: sockets.length }, "ws: ws_messages_out");

    for (const socket of sockets) {
      const clientData = socket.data as ClientData;

      const payload =
        clientData.type === "device"
          ? serializeBookingFull(booking)
          : (() => {
              const vis = bookingDetailVisibility(
                { upn: clientData.upn, isStaff: clientData.isStaff, isAdmin: clientData.isAdmin },
                { organiserUpn: booking.organiserUpn, organiserIsStaff }
              );
              return vis === "full"
                ? serializeBookingFull(booking)
                : serializeBookingBusy(booking);
            })();

      socket.emit("message", makeEnvelope(type, { booking: payload }));
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function publishBookingCreated(
  booking: Booking,
  parentId?: string | null
): Promise<void> {
  await broadcastBooking("booking.created", booking, parentId);
}

export async function publishBookingUpdated(
  booking: Booking,
  parentId?: string | null
): Promise<void> {
  await broadcastBooking("booking.updated", booking, parentId);
}

export async function publishBookingDeleted(
  roomId: string,
  bookingId: string,
  parentId?: string | null
): Promise<void> {
  let io: ReturnType<typeof getSocketServer>;
  try {
    io = getSocketServer();
  } catch {
    return;
  }

  const channels = getChannels(roomId, parentId);
  const envelope = makeEnvelope("booking.deleted", { bookingId, roomId });

  for (const channel of channels) {
    logger.info({ type: "booking.deleted", channel }, "ws: ws_messages_out");
    io.to(channel).emit("message", envelope);
  }
}

export async function publishRoomUpdated(room: Room): Promise<void> {
  let io: ReturnType<typeof getSocketServer>;
  try {
    io = getSocketServer();
  } catch {
    return;
  }

  logger.info({ type: "room.updated", roomId: room.id }, "ws: ws_messages_out");
  io.to(`room:${room.id}`).emit("message", makeEnvelope("room.updated", { room }));
}
