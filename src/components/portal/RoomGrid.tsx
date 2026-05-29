"use client";

import { useEffect, useReducer, useState } from "react";
import RoomCard from "./RoomCard";
import { computeRoomStatus } from "@/lib/booking/status";
import { useSocket } from "@/lib/socket-context";
import type { BookingSlot } from "@/hooks/useRoomLive";

interface Room {
  id: string;
  displayName: string;
  building: string | null;
  floor: string | null;
  capacity: number;
  equipment: string[];
  kind: string;
  bookable: boolean;
}

interface Props {
  rooms: Room[];
  initialBookings: BookingSlot[];
  isStaff: boolean;
  isAdmin: boolean;
  permittedRoomIds: string[];
}

type BookingsMap = Record<string, BookingSlot[]>;

type Action =
  | { type: "SNAPSHOT"; roomId: string; bookings: BookingSlot[] }
  | { type: "ADD"; booking: BookingSlot }
  | { type: "UPDATE"; booking: BookingSlot }
  | { type: "DELETE"; roomId: string; bookingId: string };

function reducer(state: BookingsMap, action: Action): BookingsMap {
  switch (action.type) {
    case "SNAPSHOT":
      return { ...state, [action.roomId]: action.bookings };
    case "ADD":
      return {
        ...state,
        [action.booking.roomId]: [...(state[action.booking.roomId] ?? []), action.booking],
      };
    case "UPDATE":
      return {
        ...state,
        [action.booking.roomId]: (state[action.booking.roomId] ?? []).map((b) =>
          b.id === action.booking.id ? action.booking : b
        ),
      };
    case "DELETE":
      return {
        ...state,
        [action.roomId]: (state[action.roomId] ?? []).filter((b) => b.id !== action.bookingId),
      };
  }
}

function buildInitialMap(bookings: BookingSlot[]): BookingsMap {
  const map: BookingsMap = {};
  for (const b of bookings) (map[b.roomId] ??= []).push(b);
  return map;
}

export default function RoomGrid({ rooms, initialBookings, isStaff, isAdmin, permittedRoomIds }: Props) {
  const { socket } = useSocket();
  const [bookingsMap, dispatch] = useReducer(reducer, initialBookings, buildInitialMap);
  const [search, setSearch] = useState("");
  const [availFilter, setAvailFilter] = useState<"any" | "free">("any");
  const [minCapacity, setMinCapacity] = useState(0);
  const [showAll, setShowAll] = useState(false);

  const permitted = new Set(permittedRoomIds);

  useEffect(() => {
    if (!socket) return;
    const roomIds = rooms.map((r) => r.id);
    socket.emit("message", { type: "subscribe", roomIds });

    function onMessage(msg: { type: string; payload: Record<string, unknown> }) {
      const p = msg.payload;
      if (msg.type === "snapshot")
        dispatch({ type: "SNAPSHOT", roomId: p.roomId as string, bookings: p.bookings as BookingSlot[] });
      else if (msg.type === "booking.created")
        dispatch({ type: "ADD", booking: p.booking as BookingSlot });
      else if (msg.type === "booking.updated")
        dispatch({ type: "UPDATE", booking: p.booking as BookingSlot });
      else if (msg.type === "booking.deleted")
        dispatch({ type: "DELETE", roomId: p.roomId as string, bookingId: p.bookingId as string });
    }

    socket.on("message", onMessage);
    return () => {
      socket.off("message", onMessage);
      socket.emit("message", { type: "unsubscribe", roomIds });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  const now = new Date();

  const filtered = rooms
    .filter((r) => {
      if (!isStaff && !isAdmin && !showAll && !permitted.has(r.id)) return false;
      if (search && !r.displayName.toLowerCase().includes(search.toLowerCase()) &&
          !r.building?.toLowerCase().includes(search.toLowerCase())) return false;
      if (r.capacity < minCapacity) return false;
      if (availFilter === "free" && computeRoomStatus(bookingsMap[r.id] ?? [], now) === "busy") return false;
      return true;
    })
    .sort((a, b) => {
      const sa = computeRoomStatus(bookingsMap[a.id] ?? [], now);
      const sb = computeRoomStatus(bookingsMap[b.id] ?? [], now);
      if (sa !== "busy" && sb === "busy") return -1;
      if (sa === "busy" && sb !== "busy") return 1;
      return a.displayName.localeCompare(b.displayName);
    });

  const freeCount = filtered.filter(
    (r) => computeRoomStatus(bookingsMap[r.id] ?? [], now) === "free"
  ).length;

  return (
    <div>
      {/* Page heading */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-md mb-lg">
        <div className="w-full md:w-auto">
          <h1 className="font-display font-extrabold text-headline-xl text-on-background mb-2">
            Room Finder
          </h1>
          <p className="text-body-md text-on-surface-variant max-w-lg">
            {isStaff || isAdmin
              ? "Find and reserve an available room for teaching, meetings or study."
              : "Find and book a room you're permitted to use."}
          </p>
        </div>

        {/* Search bar */}
        <div className="w-full md:w-96 relative">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline pointer-events-none">
            search
          </span>
          <input
            className="w-full pl-12 pr-4 py-3 bg-white border border-outline-variant rounded-xl focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all text-body-md"
            placeholder="Search by room name or building…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Two-column layout: filters left, cards right */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-gutter">
        {/* Filters panel */}
        <div className="xl:col-span-3">
          <section className="bg-white rounded-xl shadow-card p-md border border-surface-container-highest">
            <h3 className="font-display font-semibold text-headline-md mb-md">Refine Search</h3>

            <div className="space-y-md">
              {/* Availability */}
              <div>
                <label className="text-label-md font-label-md text-on-surface-variant block mb-2">
                  Availability
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(["any", "free"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setAvailFilter(v)}
                      className={`p-2.5 rounded-xl text-label-sm font-label-sm border transition-colors ${
                        availFilter === v
                          ? "border-2 border-primary bg-primary/5 text-primary font-bold"
                          : "border-outline-variant hover:border-primary"
                      }`}
                    >
                      {v === "any" ? "Any" : "Free now"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Capacity */}
              <div>
                <label className="text-label-md font-label-md text-on-surface-variant block mb-2">
                  Minimum capacity
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[0, 4, 10, 20].map((cap) => (
                    <button
                      key={cap}
                      onClick={() => setMinCapacity(cap)}
                      className={`p-2.5 rounded-xl text-label-sm font-label-sm border transition-colors ${
                        minCapacity === cap
                          ? "border-2 border-primary bg-primary/5 text-primary font-bold"
                          : "border-outline-variant hover:border-primary"
                      }`}
                    >
                      {cap === 0 ? "Any" : `${cap}+`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Show all toggle for non-staff */}
              {!isStaff && !isAdmin && (
                <div>
                  <label className="text-label-md font-label-md text-on-surface-variant block mb-2">
                    Visibility
                  </label>
                  <button
                    onClick={() => setShowAll((v) => !v)}
                    className={`w-full p-2.5 rounded-xl text-label-sm font-label-sm border transition-colors ${
                      showAll
                        ? "border-2 border-primary bg-primary/5 text-primary font-bold"
                        : "border-outline-variant hover:border-primary"
                    }`}
                  >
                    {showAll ? "Showing all rooms" : "Show all rooms"}
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Room cards */}
        <div className="xl:col-span-9">
          <div className="flex justify-between items-center mb-md">
            <h2 className="font-display font-semibold text-headline-md">
              {freeCount} room{freeCount !== 1 ? "s" : ""} available
            </h2>
            <p className="text-label-md font-label-md text-on-surface-variant">
              {filtered.length} total shown
            </p>
          </div>

          {filtered.length === 0 ? (
            <div className="bg-white rounded-xl border border-surface-container-highest shadow-card p-lg text-center">
              <span className="material-symbols-outlined text-5xl text-outline mb-4 block">search_off</span>
              <p className="text-body-md text-on-surface-variant">No rooms match your filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3 gap-gutter">
              {filtered.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  bookings={bookingsMap[room.id] ?? []}
                  canBook={permitted.has(room.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
