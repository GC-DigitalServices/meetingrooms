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

// ─── Helpers ────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** Round up to the next 15-minute slot. */
function nextQuarterHour() {
  const d = new Date();
  const m = Math.ceil(d.getMinutes() / 15) * 15;
  const h = d.getHours() + Math.floor(m / 60);
  return `${String(h % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function addHours(time: string, h: number) {
  const [hh, mm] = time.split(":").map(Number);
  const total = hh + h;
  return `${String(total % 24).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** The label shown next to available rooms on the card. */
function nextBookingLabel(bookings: BookingSlot[], now: Date): string {
  const future = bookings
    .map(b => ({ ...b, start: new Date(b.startUtc), end: new Date(b.endUtc) }))
    .filter(b => b.start > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  if (future.length === 0) return "No more bookings today";
  const next = future[0];
  const sameDay = next.startUtc.slice(0, 10) === todayStr();
  return sameDay ? `Next: ${localTime(next.startUtc)} – ${localTime(next.endUtc)}` : "Free rest of day";
}

/** The label shown on busy cards. */
function freeFromLabel(bookings: BookingSlot[], now: Date): string {
  const current = bookings.find(
    b => new Date(b.startUtc) <= now && new Date(b.endUtc) > now
  );
  return current ? `Free from ${localTime(current.endUtc)}` : "";
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function RoomGrid({ rooms, initialBookings, isStaff, isAdmin, permittedRoomIds }: Props) {
  const { socket } = useSocket();
  const [bookingsMap, dispatch] = useReducer(reducer, initialBookings, buildInitialMap);

  // Search / filter state
  const [search, setSearch] = useState("");
  const [filterDate, setFilterDate] = useState(todayStr);
  const [filterFrom, setFilterFrom] = useState(nextQuarterHour);
  const [filterTo, setFilterTo] = useState(() => addHours(nextQuarterHour(), 1));
  const [onlyFree, setOnlyFree] = useState(false);
  const [minCapacity, setMinCapacity] = useState(0);
  const [showAll, setShowAll] = useState(false);

  // Availability data fetched from API
  const [avail, setAvail] = useState<Record<string, RoomAvailability>>({});

  const permitted = new Set(permittedRoomIds);

  // ─── Socket subscriptions ────────────────────────────────────────────────
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

  // ─── Fetch availability whenever date/time changes ──────────────────────
  const fetchAvailability = useCallback(async () => {
    try {
      const from = new Date(`${filterDate}T${filterFrom}:00`).toISOString();
      const to = new Date(`${filterDate}T${filterTo}:00`).toISOString();
      const res = await fetch(`/api/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      if (res.ok) setAvail((await res.json()) as Record<string, RoomAvailability>);
    } catch { /* ignore transient fetch errors */ }
  }, [filterDate, filterFrom, filterTo]);

  useEffect(() => { void fetchAvailability(); }, [fetchAvailability]);

  // Ensure filterTo is always after filterFrom
  useEffect(() => {
    if (filterTo <= filterFrom) setFilterTo(addHours(filterFrom, 1));
  }, [filterFrom, filterTo]);

  const now = new Date();

  // ─── Filter & sort ───────────────────────────────────────────────────────
  const filtered = rooms
    .filter(r => {
      if (!isStaff && !isAdmin && !showAll && !permitted.has(r.id)) return false;
      if (search && !r.displayName.toLowerCase().includes(search.toLowerCase()) && !r.building?.toLowerCase().includes(search.toLowerCase())) return false;
      if (r.capacity < minCapacity) return false;
      if (onlyFree && avail[r.id] && !avail[r.id].free) return false;
      return true;
    })
    .sort((a, b) => {
      const af = avail[a.id]?.free !== false;
      const bf = avail[b.id]?.free !== false;
      if (af && !bf) return -1;
      if (!af && bf) return 1;
      return a.displayName.localeCompare(b.displayName);
    });

  const freeCount = filtered.filter(r => avail[r.id]?.free !== false).length;

  // ─── Time select options ─────────────────────────────────────────────────
  const TIME_OPTIONS = Array.from({ length: 53 }, (_, i) => {
    const m = 7 * 60 + i * 15;
    if (m > 21 * 60) return null;
    const h = String(Math.floor(m / 60)).padStart(2, "0");
    const min = String(m % 60).padStart(2, "0");
    return `${h}:${min}`;
  }).filter(Boolean) as string[];

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Page heading */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-md mb-lg">
        <div>
          <h1 className="font-display font-extrabold text-headline-xl text-on-background mb-2">Meeting Room Finder</h1>
          <p className="text-body-md text-on-surface-variant max-w-lg">
            {isStaff || isAdmin
              ? "Find and reserve a meeting room for teaching, meetings or study."
              : "Find and book a meeting room you're permitted to use."}
          </p>
        </div>
        <div className="w-full md:w-96 relative">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline pointer-events-none">search</span>
          <input
            className="w-full pl-12 pr-4 py-3 bg-white border border-outline-variant rounded-xl focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all text-body-md"
            placeholder="Search by room name or building…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-gutter">
        {/* Filter panel */}
        <div className="xl:col-span-3">
          <section className="bg-white rounded-xl shadow-card p-md border border-surface-container-highest">
            <h3 className="font-display font-semibold text-headline-md mb-md">Refine Search</h3>

            <div className="space-y-md">
              {/* ── When? ── */}
              <div>
                <label className="text-label-md font-label-md text-on-surface-variant block mb-2">When do you need it?</label>
                <div className="space-y-2">
                  <input
                    type="date"
                    className="w-full rounded-xl border border-outline-variant bg-background px-3 py-2 text-label-md font-label-md focus:outline-none focus:ring-2 focus:ring-primary"
                    value={filterDate}
                    min={todayStr()}
                    onChange={e => setFilterDate(e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-label-sm font-label-sm text-on-surface-variant mb-1">From</p>
                      <select
                        className="w-full rounded-xl border border-outline-variant bg-background px-2 py-2 text-label-md font-label-md focus:outline-none focus:ring-2 focus:ring-primary"
                        value={filterFrom}
                        onChange={e => setFilterFrom(e.target.value)}
                      >
                        {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <p className="text-label-sm font-label-sm text-on-surface-variant mb-1">To</p>
                      <select
                        className="w-full rounded-xl border border-outline-variant bg-background px-2 py-2 text-label-md font-label-md focus:outline-none focus:ring-2 focus:ring-primary"
                        value={filterTo}
                        onChange={e => setFilterTo(e.target.value)}
                      >
                        {TIME_OPTIONS.filter(t => t > filterFrom).map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Only show free toggle */}
                  <button
                    onClick={() => setOnlyFree(v => !v)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-label-md font-label-md transition-colors ${
                      onlyFree ? "border-2 border-primary bg-primary/5 text-primary" : "border-outline-variant text-on-surface-variant hover:border-primary"
                    }`}
                  >
                    <span className="material-symbols-outlined text-base">{onlyFree ? "check_box" : "check_box_outline_blank"}</span>
                    Show only available meeting rooms
                  </button>
                </div>
              </div>

              {/* ── Capacity ── */}
              <div>
                <label className="text-label-md font-label-md text-on-surface-variant block mb-2">Minimum capacity</label>
                <div className="grid grid-cols-2 gap-2">
                  {[0, 4, 10, 20].map(cap => (
                    <button
                      key={cap}
                      onClick={() => setMinCapacity(cap)}
                      className={`p-2.5 rounded-xl text-label-sm font-label-sm border transition-colors ${
                        minCapacity === cap ? "border-2 border-primary bg-primary/5 text-primary font-bold" : "border-outline-variant hover:border-primary"
                      }`}
                    >
                      {cap === 0 ? "Any" : `${cap}+`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Show all for non-staff */}
              {!isStaff && !isAdmin && (
                <button
                  onClick={() => setShowAll(v => !v)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-label-md font-label-md transition-colors ${
                    showAll ? "border-2 border-primary bg-primary/5 text-primary" : "border-outline-variant text-on-surface-variant hover:border-primary"
                  }`}
                >
                  <span className="material-symbols-outlined text-base">{showAll ? "check_box" : "check_box_outline_blank"}</span>
                  Show all meeting rooms
                </button>
              )}
            </div>
          </section>
        </div>

        {/* Room cards */}
        <div className="xl:col-span-9">
          <div className="flex justify-between items-center mb-md">
            <div>
              <h2 className="font-display font-semibold text-headline-md">
                {freeCount} meeting room{freeCount !== 1 ? "s" : ""} available
              </h2>
              <p className="text-label-md font-label-md text-on-surface-variant">
                {filterDate === todayStr()
                  ? `${filterFrom} – ${filterTo} today`
                  : `${new Date(filterDate + "T12:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${filterFrom} – ${filterTo}`}
              </p>
            </div>
            <p className="text-label-md font-label-md text-on-surface-variant">{filtered.length} shown</p>
          </div>

          {filtered.length === 0 ? (
            <div className="bg-white rounded-xl border border-surface-container-highest shadow-card p-lg text-center">
              <span className="material-symbols-outlined text-5xl text-outline mb-4 block">search_off</span>
              <p className="text-body-md text-on-surface-variant">No meeting rooms match your filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-gutter">
              {filtered.map(room => {
                const bk = bookingsMap[room.id] ?? [];
                const status = computeRoomStatus(bk, now);
                const statusLabel = avail[room.id]?.free === false ? "busy" : status;

                const nextLabel =
                  statusLabel === "busy"
                    ? freeFromLabel(bk, now)
                    : nextBookingLabel(bk, now);

                return (
                  <RoomCard
                    key={room.id}
                    room={room}
                    bookings={bk}
                    canBook={permitted.has(room.id)}
                    nextLabel={nextLabel}
                    filterDate={filterDate !== todayStr() ? filterDate : undefined}
                    filterStart={filterDate !== todayStr() ? filterFrom : undefined}
                    filterEnd={filterDate !== todayStr() ? filterTo : undefined}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
