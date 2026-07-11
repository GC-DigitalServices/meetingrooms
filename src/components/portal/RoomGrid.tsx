"use client";

import { useEffect, useMemo, useReducer, useRef, useState, useCallback } from "react";
import RoomCard from "./RoomCard";
import { computeRoomStatus } from "@/lib/booking/status";
import { useSocket } from "@/lib/socket-context";
import { localDateISO, timeToMinutes, minutesToTime, localTime } from "@/lib/utils";
import { freeUntilLabel, busyUntilLabel, bookedAtLabel } from "@/lib/booking/labels";
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
          b.id === action.booking.id ? action.booking : b,
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

function todayStr() {
  return localDateISO();
}

function nextQuarterHour() {
  const d = new Date();
  const m = Math.ceil(d.getMinutes() / 15) * 15;
  const totalMin = (d.getHours() + Math.floor(m / 60)) * 60 + (m % 60);
  return minutesToTime(Math.max(7 * 60, Math.min(20 * 60, totalMin)));
}

// Both clamp to the end of bookable hours (21:00) so filterTo stays a valid option.
function addMinutes(time: string, mins: number) {
  return minutesToTime(Math.min(timeToMinutes(time) + mins, 21 * 60));
}

function addHours(time: string, h: number) {
  return addMinutes(time, h * 60);
}

// 07:00 – 21:00 in 15-minute steps
const TIME_OPTIONS = Array.from({ length: 57 }, (_, i) => minutesToTime(7 * 60 + i * 15));

// Shared look for the small filter chips (building, duration quick-picks).
function chipClass(active: boolean) {
  return `px-2.5 py-1.5 text-xs rounded-full border transition-colors ${
    active
      ? "border-primary bg-primary text-on-primary font-semibold"
      : "border-outline-variant hover:border-primary text-on-surface-variant"
  }`;
}

export default function RoomGrid({
  rooms,
  initialBookings,
  isStaff,
  isAdmin,
  permittedRoomIds,
}: Props) {
  const { socket } = useSocket();
  const [bookingsMap, dispatch] = useReducer(reducer, initialBookings, buildInitialMap);

  const [filterDate, setFilterDate] = useState(todayStr);
  const [filterFrom, setFilterFrom] = useState(nextQuarterHour);
  const [filterTo, setFilterTo] = useState(() => addHours(nextQuarterHour(), 1));
  const [onlyFree, setOnlyFree] = useState(isStaff || isAdmin);
  const [minCapacity, setMinCapacity] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [building, setBuilding] = useState<string | null>(null);

  const [avail, setAvail] = useState<Record<string, RoomAvailability>>({});
  const [availLoading, setAvailLoading] = useState(false);

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
    setFavourites((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      try {
        localStorage.setItem("mrbs:fav", JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const permitted = new Set(permittedRoomIds);

  useEffect(() => {
    if (!socket) return;
    const roomIds = rooms.map((r) => r.id);
    socket.emit("message", { type: "subscribe", roomIds });

    function onMessage(msg: { type: string; payload: Record<string, unknown> }) {
      const p = msg.payload;
      if (msg.type === "snapshot")
        dispatch({
          type: "SNAPSHOT",
          roomId: p.roomId as string,
          bookings: p.bookings as BookingSlot[],
        });
      else if (msg.type === "booking.created")
        dispatch({ type: "ADD", booking: p.booking as BookingSlot });
      else if (msg.type === "booking.updated")
        dispatch({ type: "UPDATE", booking: p.booking as BookingSlot });
      else if (msg.type === "booking.deleted")
        dispatch({ type: "DELETE", roomId: p.roomId as string, bookingId: p.bookingId as string });

      // Bookings changed elsewhere — refresh the availability that drives the
      // "Show only available" filter and the free count, or they go stale.
      if (msg.type.startsWith("booking.")) void fetchAvailabilityRef.current();
    }

    socket.on("message", onMessage);
    return () => {
      socket.off("message", onMessage);
      socket.emit("message", { type: "unsubscribe", roomIds });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  // Sequence counter so an out-of-order response for an older filter window
  // can't overwrite results (or the loading flag) of a newer request.
  const availSeq = useRef(0);
  const fetchAvailability = useCallback(async () => {
    const seq = ++availSeq.current;
    setAvailLoading(true);
    try {
      const from = new Date(`${filterDate}T${filterFrom}:00`).toISOString();
      const to = new Date(`${filterDate}T${filterTo}:00`).toISOString();
      const res = await fetch(
        `/api/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      if (res.ok && seq === availSeq.current) {
        setAvail((await res.json()) as Record<string, RoomAvailability>);
      }
    } catch {
      /* ignore transient fetch errors */
    } finally {
      if (seq === availSeq.current) setAvailLoading(false);
    }
  }, [filterDate, filterFrom, filterTo]);

  useEffect(() => {
    void fetchAvailability();
  }, [fetchAvailability]);

  // Latest fetcher for the socket handler, which subscribes once per socket.
  const fetchAvailabilityRef = useRef(fetchAvailability);
  useEffect(() => {
    fetchAvailabilityRef.current = fetchAvailability;
  }, [fetchAvailability]);

  // Keep filterTo a valid option strictly after filterFrom (aim for +1 hour).
  useEffect(() => {
    if (filterTo > filterFrom) return;
    const later = TIME_OPTIONS.filter((t) => t > filterFrom);
    if (later.length === 0) return;
    const target = addHours(filterFrom, 1);
    setFilterTo(later.find((t) => t >= target) ?? later[later.length - 1]);
  }, [filterFrom, filterTo]);

  const now = new Date();

  const buildings = useMemo(
    () => [...new Set(rooms.map((r) => r.building).filter((b): b is string => !!b))].sort(),
    [rooms],
  );

  const searchLower = search.trim().toLowerCase();
  const hasActiveFilters = searchLower !== "" || building !== null || minCapacity > 0 || onlyFree;

  function clearFilters() {
    setSearch("");
    setBuilding(null);
    setMinCapacity(0);
    setOnlyFree(false);
  }

  // All filters except availability — split out so the empty state can tell
  // "everything is busy" apart from "nothing matches".
  function matchesStaticFilters(r: Room): boolean {
    if (!isAdmin && !showAll && !permitted.has(r.id)) return false;
    if (
      searchLower &&
      !r.displayName.toLowerCase().includes(searchLower) &&
      !(r.building ?? "").toLowerCase().includes(searchLower)
    )
      return false;
    if (building && r.building !== building) return false;
    if (r.capacity < minCapacity) return false;
    return true;
  }

  const filtered = rooms
    .filter((r) => matchesStaticFilters(r) && (!onlyFree || !avail[r.id] || avail[r.id].free))
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

  const favRooms = filtered.filter((r) => favourites.has(r.id));
  const otherRooms = filtered.filter((r) => !favourites.has(r.id));

  const freeCount = filtered.filter((r) => avail[r.id]?.free !== false).length;

  // When "show only available" hides everything, work out when the first
  // matching room frees up (bookings are only loaded ~48h out, so only for
  // today/tomorrow) and offer to move the search to that time.
  const busyHidden = filtered.length === 0 && onlyFree ? rooms.filter(matchesStaticFilters) : [];
  const freesUpAt: string | null = (() => {
    if (
      busyHidden.length === 0 ||
      filterDate > localDateISO(new Date(Date.now() + 24 * 60 * 60 * 1000))
    )
      return null;
    const windowStart = new Date(`${filterDate}T${filterFrom}:00`);
    const windowEnd = new Date(`${filterDate}T${filterTo}:00`);
    const ends = busyHidden.flatMap((r) =>
      (bookingsMap[r.id] ?? [])
        .filter((b) => new Date(b.startUtc) < windowEnd && new Date(b.endUtc) > windowStart)
        .map((b) => b.endUtc),
    );
    if (ends.length === 0) return null;
    const earliest = ends.sort()[0];
    if (localDateISO(earliest) !== filterDate) return null;
    // Round up to the next quarter hour; only offer times a booking can start at
    const rounded = minutesToTime(
      Math.min(Math.ceil(timeToMinutes(localTime(earliest)) / 15) * 15, 20 * 60),
    );
    return rounded < "20:00" ? rounded : null;
  })();

  const dateLabel =
    filterDate === todayStr()
      ? "Today"
      : new Date(filterDate + "T12:00").toLocaleDateString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
        });

  return (
    <div className="lg:flex lg:h-[calc(100vh-80px)] lg:overflow-hidden">
      {/* ── Filter sidebar ─────────────────────────────────────── */}
      <aside className="bg-surface-container-low border-b lg:border-b-0 lg:border-r border-outline-variant/30 lg:w-80 lg:flex-shrink-0 lg:flex lg:flex-col lg:overflow-hidden">
        {/* Mobile toggle button */}
        <button
          className="lg:hidden w-full flex items-center justify-between px-4 py-3"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
        >
          <span className="font-semibold text-sm text-on-surface">Search Filters</span>
          <span
            className="material-symbols-outlined text-on-surface-variant text-base"
            aria-hidden="true"
          >
            {filtersOpen ? "expand_less" : "tune"}
          </span>
        </button>

        {/* Filter content — always visible on desktop, toggle on mobile */}
        <div
          className={`${filtersOpen ? "block" : "hidden"} lg:flex lg:flex-col lg:flex-1 lg:overflow-hidden`}
        >
          <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-5">
            <h2 className="font-bold text-base text-on-background hidden lg:block">
              Search Filters
            </h2>
            {/* Room name search */}
            <div>
              <label
                htmlFor="room-search"
                className="text-label-md font-label-md text-on-surface-variant uppercase tracking-wider block mb-2"
              >
                Room
              </label>
              <div className="relative">
                <span
                  className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-base text-on-surface-variant"
                  aria-hidden="true"
                >
                  search
                </span>
                <input
                  id="room-search"
                  type="search"
                  placeholder="Search by name or building"
                  className="w-full rounded border border-outline-variant bg-surface-container-lowest pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            {/* Building */}
            {buildings.length > 1 && (
              <div>
                <label className="text-label-md font-label-md text-on-surface-variant uppercase tracking-wider block mb-2">
                  Building
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[null, ...buildings].map((b) => (
                    <button
                      key={b ?? "all"}
                      onClick={() => setBuilding(b)}
                      aria-pressed={building === b}
                      className={chipClass(building === b)}
                    >
                      {b ?? "All"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Date */}
            <div>
              <label className="text-label-md font-label-md text-on-surface-variant uppercase tracking-wider block mb-2">
                Date
              </label>
              <input
                type="date"
                className="w-full rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={filterDate}
                min={todayStr()}
                onChange={(e) => setFilterDate(e.target.value)}
              />
            </div>

            {/* Time */}
            <div>
              <label className="text-label-md font-label-md text-on-surface-variant uppercase tracking-wider block mb-2">
                Time
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-on-surface-variant mb-1">From</p>
                  <select
                    className="w-full rounded border border-outline-variant bg-surface-container-lowest px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    value={filterFrom}
                    onChange={(e) => setFilterFrom(e.target.value)}
                  >
                    {/* Exclude the last slot — a From of 21:00 leaves no valid To */}
                    {TIME_OPTIONS.slice(0, -1).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="text-xs text-on-surface-variant mb-1">To</p>
                  <select
                    className="w-full rounded border border-outline-variant bg-surface-container-lowest px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    value={filterTo}
                    onChange={(e) => setFilterTo(e.target.value)}
                  >
                    {TIME_OPTIONS.filter((t) => t > filterFrom).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {/* Quick picks: reset to now / set a duration from the start time */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                <button
                  onClick={() => {
                    setFilterDate(todayStr());
                    const from = nextQuarterHour();
                    setFilterFrom(from);
                    setFilterTo(addHours(from, 1));
                  }}
                  className={chipClass(false)}
                >
                  Now
                </button>
                {[
                  { label: "30 min", mins: 30 },
                  { label: "1 hour", mins: 60 },
                  { label: "2 hours", mins: 120 },
                ].map(({ label, mins }) => {
                  const to = addMinutes(filterFrom, mins);
                  return (
                    <button
                      key={mins}
                      onClick={() => setFilterTo(to)}
                      aria-pressed={filterTo === to}
                      className={chipClass(filterTo === to)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Availability */}
            <div>
              <label className="text-label-md font-label-md text-on-surface-variant uppercase tracking-wider block mb-2">
                Availability
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyFree}
                  onChange={(e) => setOnlyFree(e.target.checked)}
                  className="w-4 h-4 rounded accent-primary"
                />
                <span className="text-sm text-on-surface">Show only available</span>
              </label>
              {/* Admins already see everything; everyone else (staff included —
                  their permissions can be misconfigured) gets the toggle. */}
              {!isAdmin && (
                <label className="flex items-center gap-3 cursor-pointer mt-2">
                  <input
                    type="checkbox"
                    checked={showAll}
                    onChange={(e) => setShowAll(e.target.checked)}
                    className="w-4 h-4 rounded accent-primary"
                  />
                  <span className="text-sm text-on-surface">Show all rooms</span>
                </label>
              )}
            </div>

            {/* Capacity */}
            <div>
              <label className="text-label-md font-label-md text-on-surface-variant uppercase tracking-wider block mb-2">
                Capacity
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[0, 4, 10, 20].map((cap) => (
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

          {/* Show results — mobile only; results update live, this just closes the panel */}
          <div className="p-4 border-t border-outline-variant/30 lg:hidden">
            <button
              onClick={() => setFiltersOpen(false)}
              className="w-full bg-primary text-on-primary py-2.5 rounded font-semibold text-sm hover:bg-primary-container transition-colors"
            >
              Show results
            </button>
          </div>
        </div>
        {/* end toggle wrapper */}
      </aside>

      {/* ── Main content ──────────────────────────────────────────── */}
      <div className="flex-1 lg:overflow-y-auto custom-scrollbar">
        <div className="px-4 md:px-margin-desktop pt-lg pb-24 lg:pb-lg">
          <h1 className="font-extrabold text-headline-xl text-on-background mb-lg">
            Meeting Room Finder
          </h1>
          {/* Result header */}
          <div className="flex justify-between items-end mb-md">
            <div>
              <h2 className="font-bold text-2xl text-on-background">
                {freeCount} room{freeCount !== 1 ? "s" : ""} available
              </h2>
              <p className="text-sm text-on-surface-variant mt-0.5">
                {dateLabel}, {filterFrom} – {filterTo}
              </p>
            </div>
            <p className="text-sm text-on-surface-variant" aria-live="polite">
              {availLoading ? "Checking availability…" : `${filtered.length} shown`}
            </p>
          </div>

          {filtered.length === 0 ? (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 shadow-card p-lg text-center">
              <span
                className="material-symbols-outlined text-5xl text-outline mb-4 block"
                aria-hidden="true"
              >
                search_off
              </span>
              <p className="text-on-surface-variant">
                {!isAdmin && !showAll && permittedRoomIds.length === 0
                  ? "You don't have booking access to any rooms right now."
                  : busyHidden.length > 0
                    ? `All ${busyHidden.length} matching room${busyHidden.length !== 1 ? "s are" : " is"} booked for this time.`
                    : "No meeting rooms match your filters."}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {freesUpAt && (
                  <button
                    onClick={() => setFilterFrom(freesUpAt)}
                    className="px-4 py-2 text-sm rounded-full bg-primary text-on-primary font-semibold hover:bg-primary-container transition-colors"
                  >
                    Try from {freesUpAt} — the first room frees up then
                  </button>
                )}
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="px-4 py-2 text-sm rounded-full border border-outline-variant hover:border-primary text-on-surface transition-colors"
                  >
                    Clear filters
                  </button>
                )}
                {!isAdmin && !showAll && rooms.some((r) => !permitted.has(r.id)) && (
                  <button
                    onClick={() => setShowAll(true)}
                    className="px-4 py-2 text-sm rounded-full bg-primary text-on-primary font-semibold hover:bg-primary-container transition-colors"
                  >
                    Show all rooms
                  </button>
                )}
              </div>
            </div>
          ) : (
            (() => {
              const renderCard = (room: Room) => {
                const bk = bookingsMap[room.id] ?? [];
                const status = computeRoomStatus(bk, now);
                const nextLabel =
                  status === "busy"
                    ? busyUntilLabel(bk, now)
                    : status === "soon"
                      ? bookedAtLabel(bk, now)
                      : freeUntilLabel(bk, now);

                const freeBayCount =
                  room.kind === "PARKING" && room.bayIds
                    ? room.bayIds.filter((bayId) => {
                        const bayBk = bookingsMap[bayId] ?? [];
                        return !bayBk.some(
                          (b) => new Date(b.startUtc) <= now && new Date(b.endUtc) > now,
                        );
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
              };

              const grid = "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-gutter";
              const heading = (icon: string, text: string) => (
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-on-surface-variant uppercase tracking-wider mb-3">
                  <span className="material-symbols-outlined text-base" aria-hidden="true">
                    {icon}
                  </span>
                  {text}
                </h3>
              );

              // Favourited rooms get their own labelled section
              return favRooms.length > 0 ? (
                <>
                  <section className="mb-8">
                    {heading("star", "Favourites")}
                    <div className={grid}>{favRooms.map(renderCard)}</div>
                  </section>
                  {otherRooms.length > 0 && (
                    <section>
                      {heading("meeting_room", "All rooms")}
                      <div className={grid}>{otherRooms.map(renderCard)}</div>
                    </section>
                  )}
                </>
              ) : (
                <div className={grid}>{filtered.map(renderCard)}</div>
              );
            })()
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
