"use client";

import { useEffect, useReducer, useState, useCallback } from "react";
import RoomCard from "./RoomCard";
import { computeRoomStatus } from "@/lib/booking/status";
import { useSocket } from "@/lib/socket-context";
import { localTime } from "@/lib/utils";
import type { BookingSlot } from "@/hooks/useRoomLive";
import type { RoomAvailability } from "@/app/api/availability/route";

interface Room {
  id: string;
  displayName: string;
  building: string | null;
  floor: string | null;
  capacity: number;
  equipment: string[];
  kind: string;
  bookable: boolean;
  bayIds?: string[];
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
    case "SNAPSHOT": return { ...state, [action.roomId]: action.bookings };
    case "ADD": return { ...state, [action.booking.roomId]: [...(state[action.booking.roomId] ?? []), action.booking] };
    case "UPDATE": return { ...state, [action.booking.roomId]: (state[action.booking.roomId] ?? []).map(b => b.id === action.booking.id ? action.booking : b) };
    case "DELETE": return { ...state, [action.roomId]: (state[action.roomId] ?? []).filter(b => b.id !== action.bookingId) };
  }
}

function buildInitialMap(bookings: BookingSlot[]): BookingsMap {
  const map: BookingsMap = {};
  for (const b of bookings) (map[b.roomId] ??= []).push(b);
  return map;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function nextQuarterHour() {
  const d = new Date();
  const m = Math.ceil(d.getMinutes() / 15) * 15;
  const totalMin = (d.getHours() + Math.floor(m / 60)) * 60 + (m % 60);
  const clamped = Math.max(7 * 60, Math.min(20 * 60, totalMin));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

function addHours(time: string, h: number) {
  const [hh, mm] = time.split(":").map(Number);
  const total = hh + h;
  return `${String(total % 24).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function freeUntilLabel(bookings: BookingSlot[], now: Date): string {
  const today = now.toISOString().slice(0, 10);
  const next = bookings
    .filter(b => new Date(b.startUtc) > now)
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc))[0];
  if (!next || next.startUtc.slice(0, 10) !== today) return "Free all day";
  return `Free until ${localTime(next.startUtc)}`;
}

function busyUntilLabel(bookings: BookingSlot[], now: Date): string {
  const current = bookings.find(
    b => new Date(b.startUtc) <= now && new Date(b.endUtc) > now
  );
  return current ? `Busy until ${localTime(current.endUtc)}` : "";
}

function bookedAtLabel(bookings: BookingSlot[], now: Date): string {
  const soon = new Date(now.getTime() + 30 * 60 * 1000);
  const next = bookings
    .filter(b => new Date(b.startUtc) > now && new Date(b.startUtc) <= soon)
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc))[0];
  return next ? `Booked at ${localTime(next.startUtc)}` : "";
}

export default function RoomGrid({ rooms, initialBookings, isStaff, isAdmin, permittedRoomIds }: Props) {
  const { socket } = useSocket();
  const [bookingsMap, dispatch] = useReducer(reducer, initialBookings, buildInitialMap);

  const [filterDate, setFilterDate] = useState(todayStr);
  const [filterFrom, setFilterFrom] = useState(nextQuarterHour);
  const [filterTo, setFilterTo] = useState(() => addHours(nextQuarterHour(), 1));
  const [onlyFree, setOnlyFree] = useState(isStaff || isAdmin);
  const [minCapacity, setMinCapacity] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [avail, setAvail] = useState<Record<string, RoomAvailability>>({});

  const [favourites, setFavourites] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const saved = localStorage.getItem("mrbs:fav");
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });

  function toggleFavourite(roomId: string) {
    setFavourites(prev => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId); else next.add(roomId);
      try { localStorage.setItem("mrbs:fav", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  const permitted = new Set(permittedRoomIds);

  useEffect(() => {
    if (!socket) return;
    const roomIds = rooms.map(r => r.id);
    socket.emit("message", { type: "subscribe", roomIds });

    function onMessage(msg: { type: string; payload: Record<string, unknown> }) {
      const p = msg.payload;
      if (msg.type === "snapshot") dispatch({ type: "SNAPSHOT", roomId: p.roomId as string, bookings: p.bookings as BookingSlot[] });
      else if (msg.type === "booking.created") dispatch({ type: "ADD", booking: p.booking as BookingSlot });
      else if (msg.type === "booking.updated") dispatch({ type: "UPDATE", booking: p.booking as BookingSlot });
      else if (msg.type === "booking.deleted") dispatch({ type: "DELETE", roomId: p.roomId as string, bookingId: p.bookingId as string });
    }

    socket.on("message", onMessage);
    return () => { socket.off("message", onMessage); socket.emit("message", { type: "unsubscribe", roomIds }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  const fetchAvailability = useCallback(async () => {
    try {
      const from = new Date(`${filterDate}T${filterFrom}:00`).toISOString();
      const to = new Date(`${filterDate}T${filterTo}:00`).toISOString();
      const res = await fetch(`/api/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      if (res.ok) setAvail((await res.json()) as Record<string, RoomAvailability>);
    } catch { /* ignore transient fetch errors */ }
  }, [filterDate, filterFrom, filterTo]);

  useEffect(() => { void fetchAvailability(); }, [fetchAvailability]);

  useEffect(() => {
    if (filterTo <= filterFrom) setFilterTo(addHours(filterFrom, 1));
  }, [filterFrom, filterTo]);

  const now = new Date();

  const filtered = rooms
    .filter(r => {
      if (!isAdmin && !showAll && !permitted.has(r.id)) return false;
      if (r.capacity < minCapacity) return false;
      if (onlyFree && avail[r.id] && !avail[r.id].free) return false;
      return true;
    })
    .sort((a, b) => {
      const afav = favourites.has(a.id);
      const bfav = favourites.has(b.id);
      if (afav && !bfav) return -1;
      if (!afav && bfav) return 1;
      const af = avail[a.id]?.free !== false;
      const bf = avail[b.id]?.free !== false;
      if (af && !bf) return -1;
      if (!af && bf) return 1;
      return a.displayName.localeCompare(b.displayName);
    });

  const freeCount = filtered.filter(r => avail[r.id]?.free !== false).length;

  const TIME_OPTIONS = Array.from({ length: 57 }, (_, i) => {
    const m = 7 * 60 + i * 15;
    if (m > 21 * 60) return null;
    const h = String(Math.floor(m / 60)).padStart(2, "0");
    const min = String(m % 60).padStart(2, "0");
    return `${h}:${min}`;
  }).filter(Boolean) as string[];

  const dateLabel = filterDate === todayStr()
    ? "Today"
    : new Date(filterDate + "T12:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="lg:flex lg:h-[calc(100vh-80px)] lg:overflow-hidden">
      {/* ── Filter sidebar ─────────────────────────────────────── */}
      <aside className="bg-surface-container-low border-b lg:border-b-0 lg:border-r border-outline-variant/30 lg:w-80 lg:flex-shrink-0 lg:flex lg:flex-col lg:overflow-hidden">
        {/* Mobile toggle button */}
        <button
          className="lg:hidden w-full flex items-center justify-between px-4 py-3"
          onClick={() => setFiltersOpen(v => !v)}
          aria-expanded={filtersOpen}
        >
          <span className="font-semibold text-sm text-on-surface">Search Filters</span>
          <span className="material-symbols-outlined text-on-surface-variant text-base">
            {filtersOpen ? "expand_less" : "tune"}
          </span>
        </button>

        {/* Filter content — always visible on desktop, toggle on mobile */}
        <div className={`${filtersOpen ? "block" : "hidden"} lg:flex lg:flex-col lg:flex-1 lg:overflow-hidden`}>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-5">
          <h2 className="font-bold text-base text-on-background hidden lg:block">Search Filters</h2>
          {/* Date */}
          <div>
            <label className="text-label-md font-label-md text-on-surface-variant uppercase tracking-wider block mb-2">Date</label>
            <input
              type="date"
              className="w-full rounded border border-outline-variant bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={filterDate}
              min={todayStr()}
              onChange={e => setFilterDate(e.target.value)}
            />
          </div>

          {/* Time */}
          <div>
            <label className="text-label-md font-label-md text-on-surface-variant uppercase tracking-wider block mb-2">Time</label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs text-on-surface-variant mb-1">From</p>
                <select
                  className="w-full rounded border border-outline-variant bg-white px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  value={filterFrom}
                  onChange={e => setFilterFrom(e.target.value)}
                >
                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <p className="text-xs text-on-surface-variant mb-1">To</p>
                <select
                  className="w-full rounded border border-outline-variant bg-white px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  value={filterTo}
                  onChange={e => setFilterTo(e.target.value)}
                >
                  {TIME_OPTIONS.filter(t => t > filterFrom).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Availability */}
          <div>
            <label className="text-label-md font-label-md text-on-surface-variant uppercase tracking-wider block mb-2">Availability</label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyFree}
                onChange={e => setOnlyFree(e.target.checked)}
                className="w-4 h-4 rounded accent-primary"
              />
              <span className="text-sm text-on-surface">Show only available</span>
            </label>
            {!isStaff && !isAdmin && (
              <label className="flex items-center gap-3 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={e => setShowAll(e.target.checked)}
                  className="w-4 h-4 rounded accent-primary"
                />
                <span className="text-sm text-on-surface">Show all rooms</span>
              </label>
            )}
          </div>

          {/* Capacity */}
          <div>
            <label className="text-label-md font-label-md text-on-surface-variant uppercase tracking-wider block mb-2">Capacity</label>
            <div className="grid grid-cols-2 gap-2">
              {[0, 4, 10, 20].map(cap => (
                <button
                  key={cap}
                  onClick={() => setMinCapacity(cap)}
                  className={`py-2 text-sm rounded border transition-colors ${
                    minCapacity === cap
                      ? "border-primary bg-primary text-on-primary font-semibold"
                      : "border-outline-variant hover:border-primary text-on-surface-variant"
                  }`}
                >
                  {cap === 0 ? "Any" : `${cap}+`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Apply button */}
        <div className="p-4 border-t border-outline-variant/30">
          <button
            onClick={() => { void fetchAvailability(); setFiltersOpen(false); }}
            className="w-full bg-primary text-on-primary py-2.5 rounded font-semibold text-sm hover:bg-primary-container transition-colors"
          >
            Apply Filters
          </button>
        </div>
        </div>{/* end toggle wrapper */}
      </aside>

      {/* ── Main content ──────────────────────────────────────────── */}
      <div className="flex-1 lg:overflow-y-auto custom-scrollbar">
        <div className="px-4 md:px-margin-desktop pt-lg pb-24 lg:pb-lg">
          <h1 className="font-extrabold text-headline-xl text-on-background mb-lg">Meeting Room Finder</h1>
          {/* Result header */}
          <div className="flex justify-between items-end mb-md">
            <div>
              <h1 className="font-bold text-2xl text-on-background">
                {freeCount} room{freeCount !== 1 ? "s" : ""} available
              </h1>
              <p className="text-sm text-on-surface-variant mt-0.5">
                {dateLabel}, {filterFrom} – {filterTo}
              </p>
            </div>
            <p className="text-sm text-on-surface-variant">{filtered.length} shown</p>
          </div>

          {filtered.length === 0 ? (
            <div className="bg-white rounded-xl border border-outline-variant/30 shadow-card p-lg text-center">
              <span className="material-symbols-outlined text-5xl text-outline mb-4 block">search_off</span>
              <p className="text-on-surface-variant">No meeting rooms match your filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-gutter">
              {filtered.map(room => {
                const bk = bookingsMap[room.id] ?? [];
                const status = computeRoomStatus(bk, now);
                const nextLabel =
                  status === "busy" ? busyUntilLabel(bk, now)
                  : status === "soon" ? bookedAtLabel(bk, now)
                  : freeUntilLabel(bk, now);

                const freeBayCount = room.kind === "PARKING" && room.bayIds
                  ? room.bayIds.filter(bayId => {
                      const bayBk = bookingsMap[bayId] ?? [];
                      return !bayBk.some(b => new Date(b.startUtc) <= now && new Date(b.endUtc) > now);
                    }).length
                  : undefined;

                return (
                  <RoomCard
                    key={room.id}
                    room={room}
                    bookings={bk}
                    canBook={permitted.has(room.id)}
                    nextLabel={nextLabel}
                    filterDate={filterDate}
                    filterStart={filterFrom}
                    filterEnd={filterTo}
                    isFavourite={favourites.has(room.id)}
                    onToggleFavourite={() => toggleFavourite(room.id)}
                    freeBayCount={freeBayCount}
                  />
                );
              })}
            </div>
          )}

          {/* Footer */}
          <footer className="mt-16 pt-8 border-t border-outline-variant/30 text-center text-xs text-on-surface-variant">
            <p>Meeting Rooms V1.0 · Greenhead College</p>
          </footer>
        </div>
      </div>
    </div>
  );
}
