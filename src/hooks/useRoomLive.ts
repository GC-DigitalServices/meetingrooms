"use client";

import { useEffect, useReducer } from "react";
import { useSocket } from "@/lib/socket-context";

export interface BookingSlot {
  id: string;
  roomId: string;
  startUtc: string;
  endUtc: string;
  isAllDay: boolean;
  visibility: "full" | "busy";
  subject?: string;
  organiserUpn?: string;
  organiserName?: string;
  source?: string;
}

type Action =
  | { type: "SNAPSHOT"; bookings: BookingSlot[] }
  | { type: "ADD"; booking: BookingSlot }
  | { type: "UPDATE"; booking: BookingSlot }
  | { type: "DELETE"; bookingId: string };

// The server snapshot only covers now → +48h (computeSnapshot in
// src/lib/realtime/socket.ts), but consumers like DayTimeline render up to
// 7 days from their server-loaded initial state. Within the snapshot window
// the snapshot is authoritative; outside it, keep what we already have.
const SNAPSHOT_WINDOW_MS = 48 * 60 * 60 * 1000;

function reducer(state: BookingSlot[], action: Action): BookingSlot[] {
  switch (action.type) {
    case "SNAPSHOT": {
      const snapshotIds = new Set(action.bookings.map((b) => b.id));
      const nowMs = Date.now();
      const horizonMs = nowMs + SNAPSHOT_WINDOW_MS;
      const outsideWindow = state.filter(
        (b) =>
          !snapshotIds.has(b.id) &&
          (new Date(b.endUtc).getTime() <= nowMs || new Date(b.startUtc).getTime() >= horizonMs),
      );
      return [...outsideWindow, ...action.bookings];
    }
    case "ADD":
      return state.some((b) => b.id === action.booking.id) ? state : [...state, action.booking];
    case "UPDATE":
      return state.some((b) => b.id === action.booking.id)
        ? state.map((b) => (b.id === action.booking.id ? action.booking : b))
        : [...state, action.booking];
    case "DELETE":
      return state.filter((b) => b.id !== action.bookingId);
  }
}

interface Envelope {
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Subscribes to a single room's live booking updates via Socket.IO.
 * Merges real-time events on top of the provided initial snapshot.
 */
export function useRoomLive(roomId: string, initial: BookingSlot[] = []): BookingSlot[] {
  const { socket } = useSocket();
  const [bookings, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    if (!socket || !roomId) return;

    socket.emit("message", { type: "subscribe", roomIds: [roomId] });

    function onMessage(msg: Envelope) {
      const p = msg.payload;
      if (msg.type === "snapshot" && p.roomId === roomId) {
        dispatch({ type: "SNAPSHOT", bookings: p.bookings as BookingSlot[] });
      } else if (msg.type === "booking.created") {
        const b = p.booking as BookingSlot;
        if (b.roomId === roomId) dispatch({ type: "ADD", booking: b });
      } else if (msg.type === "booking.updated") {
        const b = p.booking as BookingSlot;
        if (b.roomId === roomId) dispatch({ type: "UPDATE", booking: b });
      } else if (msg.type === "booking.deleted" && p.roomId === roomId) {
        dispatch({ type: "DELETE", bookingId: p.bookingId as string });
      }
    }

    socket.on("message", onMessage);

    return () => {
      socket.off("message", onMessage);
      socket.emit("message", { type: "unsubscribe", roomIds: [roomId] });
    };
  }, [socket, roomId]);

  return bookings;
}
