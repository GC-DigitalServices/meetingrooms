"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import { useSocket } from "@/lib/socket-context";
import { ParkingBookButton } from "./ParkingBookButton";
import { localTime } from "@/lib/utils";
import { BOOKABLE_START_MIN, BOOKABLE_END_MIN } from "@/lib/booking/hours";
import type { BookingSlot } from "@/hooks/useRoomLive";

interface PoolBooking {
  id: string;
  roomId: string;
  startUtc: string;
  endUtc: string;
  subject?: string | null;
  organiserName?: string | null;
}

interface Props {
  pool: { id: string; displayName: string };
  bayIds: string[];
  isToday: boolean;
  canBook: boolean;
  /** UTC ms of London midnight on the selected date */
  dayStartMs: number;
  initialBookings: PoolBooking[];
}

type Action =
  | { type: "ADD"; booking: PoolBooking }
  | { type: "UPDATE"; booking: PoolBooking }
  | { type: "DELETE"; bookingId: string };

function reducer(state: PoolBooking[], action: Action): PoolBooking[] {
  switch (action.type) {
    case "ADD":
      return state.some((b) => b.id === action.booking.id) ? state : [...state, action.booking];
    case "UPDATE":
      // Upsert: a booking rescheduled INTO the viewed day arrives as an
      // update for an id we've never seen.
      return state.some((b) => b.id === action.booking.id)
        ? state.map((b) => (b.id === action.booking.id ? action.booking : b))
        : [...state, action.booking];
    case "DELETE":
      return state.filter((b) => b.id !== action.bookingId);
  }
}

/**
 * Live view of one parking pool for one day: bay-count header, per-slot
 * availability grid and the day's booking list, updated over the socket as
 * bays are booked or freed. Socket snapshots are ignored — they only cover
 * ~48h, which would wipe server-loaded bookings for further-out dates.
 */
export default function CarparkPoolLive({
  pool,
  bayIds,
  isToday,
  canBook,
  dayStartMs,
  initialBookings,
}: Props) {
  const { socket } = useSocket();
  const [bookings, dispatch] = useReducer(reducer, initialBookings);
  // Re-render every minute so "free right now" and past-slot greying stay honest
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!isToday) return;
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [isToday]);

  useEffect(() => {
    if (!socket) return;
    const roomIds = bayIds;
    const subscribe = () => socket.emit("message", { type: "subscribe", roomIds });
    if (socket.connected) subscribe();
    socket.on("connect", subscribe); // re-subscribe after any reconnect

    function onMessage(msg: { type: string; payload: Record<string, unknown> }) {
      const p = msg.payload;
      if (msg.type === "booking.created" || msg.type === "booking.updated") {
        const b = p.booking as BookingSlot;
        if (!roomIds.includes(b.roomId)) return;
        dispatch({
          type: msg.type === "booking.created" ? "ADD" : "UPDATE",
          booking: {
            id: b.id,
            roomId: b.roomId,
            startUtc: b.startUtc,
            endUtc: b.endUtc,
            subject: b.subject,
            organiserName: b.organiserName,
          },
        });
      } else if (msg.type === "booking.deleted" && roomIds.includes(p.roomId as string)) {
        dispatch({ type: "DELETE", bookingId: p.bookingId as string });
      }
    }

    socket.on("message", onMessage);
    return () => {
      socket.off("connect", subscribe);
      socket.off("message", onMessage);
      socket.emit("message", { type: "unsubscribe", roomIds });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  const totalBays = bayIds.length;
  const nowMs = Date.now();
  const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;

  // Parse ISO strings once per bookings change, not per slot per render —
  // this component re-renders every minute and on every socket event
  const timed = useMemo(
    () =>
      bookings.map((b) => ({
        booking: b,
        startMs: new Date(b.startUtc).getTime(),
        endMs: new Date(b.endUtc).getTime(),
      })),
    [bookings],
  );

  // Slot boundaries and labels are fixed for the day. Derived from the bookable
  // window so the availability strip always covers the times a bay can be booked.
  const SLOT_MIN = 30;
  const slotDefs = useMemo(
    () =>
      Array.from({ length: (BOOKABLE_END_MIN - BOOKABLE_START_MIN) / SLOT_MIN }, (_, i) => {
        const startMs = dayStartMs + (BOOKABLE_START_MIN + i * SLOT_MIN) * 60 * 1000;
        return { startMs, endMs: startMs + 30 * 60 * 1000, time: localTime(new Date(startMs)) };
      }),
    [dayStartMs],
  );

  // Only bookings that touch the selected day (events can bring in others)
  const dayRelevant = timed.filter((t) => t.startMs < dayEndMs && t.endMs > dayStartMs);

  const bookedNow = isToday
    ? dayRelevant.filter((t) => t.startMs <= nowMs && t.endMs > nowMs).length
    : 0;
  const freeNow = totalBays - bookedNow;

  const dayBookings = dayRelevant
    .filter((t) => t.startMs >= dayStartMs)
    .sort((a, b) => a.startMs - b.startMs)
    .map((t) => t.booking);

  // 30-minute slots, 07:00–20:00 London
  const slots = slotDefs.map(({ startMs, endMs, time }) => {
    const booked = dayRelevant.filter((t) => t.startMs < endMs && t.endMs > startMs).length;
    return { time, free: totalBays - booked, isPast: isToday && endMs < nowMs };
  });

  return (
    <section>
      {/* Pool header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-md">
        <div>
          <h2 className="text-xl font-bold text-on-background">{pool.displayName}</h2>
          <div className="flex items-center gap-3 mt-1 text-sm text-on-surface-variant">
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-sm" aria-hidden="true">
                local_parking
              </span>
              {totalBays} bays total
            </span>
            {isToday && (
              <span
                className={`font-semibold ${freeNow > 0 ? "text-green-700" : "text-red-600"}`}
                aria-live="polite"
              >
                {freeNow} available right now
              </span>
            )}
          </div>
        </div>

        {canBook && <ParkingBookButton roomId={pool.id} roomName={pool.displayName} />}
      </div>

      {/* Slot availability grid */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-card overflow-hidden">
        <div className="px-4 py-3 border-b border-outline-variant/20 bg-surface-container-low">
          <h3 className="text-sm font-semibold text-on-surface">
            {isToday ? "Today's availability" : "Availability"}
          </h3>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
            {slots.map(({ time, free, isPast }) => (
              <div
                key={time}
                className={`rounded p-2 text-center text-xs ${
                  isPast
                    ? "bg-surface-container text-on-surface-variant/50"
                    : free === 0
                      ? "bg-red-50 text-red-700"
                      : free <= 2
                        ? "bg-amber-50 text-amber-700"
                        : "bg-green-50 text-green-700"
                }`}
              >
                <div className="font-semibold">{time}</div>
                <div className={isPast ? "" : "font-bold"}>
                  {isPast ? "—" : `${free}/${totalBays}`}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-on-surface-variant mt-3">
            Green = bays free · Amber = limited · Red = full
          </p>
        </div>
      </div>

      {/* Bookings list for the selected day */}
      {dayBookings.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
            {isToday ? "Today's bookings" : "Bookings"}
          </h3>
          <div className="space-y-1">
            {dayBookings.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-3 text-sm border rounded px-3 py-2 bg-surface-container-lowest"
              >
                <span
                  className="material-symbols-outlined text-sm text-on-surface-variant"
                  aria-hidden="true"
                >
                  schedule
                </span>
                <span className="text-on-surface-variant whitespace-nowrap">
                  {localTime(b.startUtc)} – {localTime(b.endUtc)}
                </span>
                <span className="text-on-surface">{b.subject || b.organiserName || ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
