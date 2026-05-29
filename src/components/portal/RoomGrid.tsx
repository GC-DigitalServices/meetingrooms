"use client";

import { useEffect, useReducer, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

// Keyed bookings map: roomId → BookingSlot[]
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

export default function RoomGrid({
  rooms,
  initialBookings,
  isStaff,
  isAdmin,
  permittedRoomIds,
}: Props) {
  const { socket, connState } = useSocket();
  const [bookingsMap, dispatch] = useReducer(reducer, initialBookings, buildInitialMap);
  const [search, setSearch] = useState("");
  const [availFilter, setAvailFilter] = useState<"any" | "free">("any");
  const [minCapacity, setMinCapacity] = useState(0);
  const [showAll, setShowAll] = useState(false);

  const permitted = new Set(permittedRoomIds);

  // Subscribe to all visible rooms via Socket.IO
  useEffect(() => {
    if (!socket) return;
    const roomIds = rooms.map((r) => r.id);
    socket.emit("message", { type: "subscribe", roomIds });

    function onMessage(msg: { type: string; payload: Record<string, unknown> }) {
      const p = msg.payload;
      if (msg.type === "snapshot") {
        dispatch({ type: "SNAPSHOT", roomId: p.roomId as string, bookings: p.bookings as BookingSlot[] });
      } else if (msg.type === "booking.created") {
        dispatch({ type: "ADD", booking: p.booking as BookingSlot });
      } else if (msg.type === "booking.updated") {
        dispatch({ type: "UPDATE", booking: p.booking as BookingSlot });
      } else if (msg.type === "booking.deleted") {
        dispatch({ type: "DELETE", roomId: p.roomId as string, bookingId: p.bookingId as string });
      }
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
      // Visibility: non-staff see only permitted rooms unless showAll
      if (!isStaff && !isAdmin && !showAll && !permitted.has(r.id)) return false;
      // Search
      if (
        search &&
        !r.displayName.toLowerCase().includes(search.toLowerCase()) &&
        !r.building?.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      // Capacity
      if (r.capacity < minCapacity) return false;
      // Availability
      if (availFilter === "free") {
        if (computeRoomStatus(bookingsMap[r.id] ?? [], now) === "busy") return false;
      }
      return true;
    })
    .sort((a, b) => {
      const sa = computeRoomStatus(bookingsMap[a.id] ?? [], now);
      const sb = computeRoomStatus(bookingsMap[b.id] ?? [], now);
      if (sa !== "busy" && sb === "busy") return -1;
      if (sa === "busy" && sb !== "busy") return 1;
      return a.displayName.localeCompare(b.displayName);
    });

  const loading = connState === "connecting" && Object.keys(bookingsMap).length === 0;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9"
            placeholder="Search rooms…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={availFilter}
          onChange={(e) => setAvailFilter(e.target.value as "any" | "free")}
        >
          <option value="any">Any availability</option>
          <option value="free">Free now</option>
        </select>

        <select
          className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={minCapacity}
          onChange={(e) => setMinCapacity(Number(e.target.value))}
        >
          <option value={0}>Any capacity</option>
          <option value={4}>4+ people</option>
          <option value={8}>8+ people</option>
          <option value={12}>12+ people</option>
          <option value={20}>20+ people</option>
        </select>

        {/* Show all toggle — only shown to non-staff who don't see all rooms by default */}
        {!isStaff && !isAdmin && (
          <Button
            variant={showAll ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Showing all rooms" : "Show all rooms"}
          </Button>
        )}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-16">No rooms match your filters.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
  );
}
