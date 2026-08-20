"use client";

import { useState } from "react";
import Link from "next/link";
import BookingDialog from "./BookingDialog";
import { computeRoomStatus } from "@/lib/booking/status";
import { STATUS_META } from "./statusMeta";
import { localTime, localDateISO, timeToMinutes } from "@/lib/utils";
import type { BookingSlot } from "@/hooks/useRoomLive";

// Minutes since midnight, Europe/London
function londonMinutes(iso: string): number {
  return timeToMinutes(localTime(iso));
}

const STRIP_START = 7 * 60; // 07:00
const STRIP_END = 21 * 60; // 21:00
const STRIP_SPAN = STRIP_END - STRIP_START;

/** Thin bar showing when the room is booked between 07:00 and 21:00 on one day. */
function AvailabilityStrip({ bookings, date }: { bookings: BookingSlot[]; date: string }) {
  const segments = bookings
    .filter((b) => localDateISO(b.startUtc) <= date && localDateISO(b.endUtc) >= date)
    .map((b) => {
      const start = localDateISO(b.startUtc) === date ? londonMinutes(b.startUtc) : STRIP_START;
      const end = localDateISO(b.endUtc) === date ? londonMinutes(b.endUtc) : STRIP_END;
      return { id: b.id, start, end };
    })
    .filter((s) => s.end > STRIP_START && s.start < STRIP_END)
    .map((s) => {
      const left = ((Math.max(s.start, STRIP_START) - STRIP_START) / STRIP_SPAN) * 100;
      const right = ((Math.min(s.end, STRIP_END) - STRIP_START) / STRIP_SPAN) * 100;
      return { id: s.id, left, width: Math.max(right - left, 0.5) };
    });

  return (
    <div className="mb-4" aria-hidden="true" title="Booked times, 07:00–21:00">
      <div className="relative h-1.5 rounded-full bg-outline-variant/30 overflow-hidden">
        {segments.map((s) => (
          <div
            key={s.id}
            className="absolute top-0 h-full rounded-full"
            style={{
              left: `${s.left}%`,
              width: `${s.width}%`,
              background: "var(--status-busy)",
              opacity: 0.75,
            }}
          />
        ))}
      </div>
      <div className="flex justify-between mt-0.5 text-[10px] text-on-surface-variant/70">
        <span>07:00</span>
        <span>21:00</span>
      </div>
    </div>
  );
}

interface Room {
  id: string;
  displayName: string;
  building: string | null;
  floor: string | null;
  capacity: number;
  equipment: string[];
  kind: string;
  bayIds?: string[];
}

interface Props {
  room: Room;
  bookings: BookingSlot[];
  canBook: boolean;
  nextLabel?: string;
  filterDate?: string;
  filterStart?: string;
  filterEnd?: string;
  isAdmin?: boolean;
  isFavourite?: boolean;
  onToggleFavourite?: () => void;
  freeBayCount?: number;
}

const EQUIP_ICON: Record<string, string> = {
  projector: "videocam",
  tv: "tv",
  screen: "tv",
  wifi: "wifi",
  av: "speaker",
  whiteboard: "draw",
  pc: "computer",
  computers: "computer",
};

const BUILDING_ICON: Record<string, string> = {
  Hirst: "science",
  Cooksey: "palette",
  Conway: "people",
  Dawson: "menu_book",
  Main: "terminal",
  Park: "fitness_center",
  Rostron: "calculate",
};

const KIND_ICON: Record<string, string> = {
  PARKING: "local_parking",
};

export default function RoomCard({
  room,
  bookings,
  canBook,
  nextLabel,
  filterDate,
  filterStart,
  filterEnd,
  isAdmin,
  isFavourite,
  onToggleFavourite,
  freeBayCount,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const status = computeRoomStatus(bookings);
  const badge = STATUS_META[status];

  const scheduleDate = filterDate ?? localDateISO();

  // The grid only loads bookings for roughly the next 48 hours, so the strip
  // would falsely read "all free" for dates beyond tomorrow — hide it there.
  const stripHasData = scheduleDate <= localDateISO(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const todayBookings = bookings
    .filter((b) => localDateISO(b.startUtc) === scheduleDate)
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc));

  const buildingIcon =
    KIND_ICON[room.kind] ?? (room.building && BUILDING_ICON[room.building]) ?? "meeting_room";
  const bookLabel =
    room.kind === "PARKING"
      ? "Book a Bay"
      : filterStart && filterEnd
        ? `Book ${filterStart} – ${filterEnd}`
        : "Book Room";

  return (
    <>
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-card hover:shadow-card-hover hover:scale-[1.02] transition-all duration-200 overflow-hidden">
        {/* Card header */}
        <Link
          href={`/rooms/${room.id}`}
          className="block relative h-44 bg-primary-container overflow-hidden"
        >
          {/* Dot pattern */}
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)",
              backgroundSize: "20px 20px",
            }}
          />
          {/* Icon + building label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <span
              className="material-symbols-outlined text-5xl text-on-primary/60"
              aria-hidden="true"
            >
              {buildingIcon}
            </span>
            <span className="text-xs text-on-primary/50 uppercase tracking-widest font-medium">
              {room.building ?? ""}
              {room.floor ? ` · ${room.floor}` : ""}
            </span>
          </div>
          {/* Status badge — top right */}
          <div className="absolute top-3 right-3">
            {room.kind === "PARKING" && freeBayCount !== undefined ? (
              <span
                className={`text-xs font-semibold px-2.5 py-1 rounded-full ${freeBayCount > 0 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}
              >
                {freeBayCount} / {room.bayIds?.length ?? 9} free
              </span>
            ) : (
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${badge.className}`}>
                {badge.label}
              </span>
            )}
          </div>
          {/* Favourite — top left */}
          {onToggleFavourite && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleFavourite();
              }}
              className="absolute top-3 left-3 p-1.5 rounded-full bg-black/25 hover:bg-black/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label={isFavourite ? "Remove from favourites" : "Add to favourites"}
              aria-pressed={isFavourite}
            >
              <span
                className={`material-symbols-outlined text-sm ${isFavourite ? "filled text-secondary-fixed" : "text-white/90"}`}
                aria-hidden="true"
              >
                {isFavourite ? "star" : "star_outline"}
              </span>
            </button>
          )}
        </Link>

        {/* Card body */}
        <div className="p-4">
          <Link
            href={`/rooms/${room.id}`}
            className="font-bold text-base text-on-background hover:text-primary transition-colors leading-tight block mb-1"
          >
            {room.displayName}
          </Link>

          {nextLabel && (
            <p className="text-xs text-on-surface-variant mb-3 flex items-center gap-1">
              <span className="material-symbols-outlined text-sm" aria-hidden="true">
                schedule
              </span>
              {nextLabel}
            </p>
          )}

          {room.kind !== "PARKING" && stripHasData && (
            <AvailabilityStrip bookings={bookings} date={scheduleDate} />
          )}

          <div className="flex flex-wrap gap-4 mb-4 text-on-surface-variant">
            <div className="flex items-center gap-1 text-sm">
              <span className="material-symbols-outlined text-base" aria-hidden="true">
                {room.kind === "PARKING" ? "local_parking" : "groups"}
              </span>
              {room.kind === "PARKING"
                ? `${room.bayIds?.length ?? room.capacity} bays`
                : `${room.capacity} ${room.capacity === 1 ? "person" : "people"}`}
            </div>
            {room.equipment.slice(0, 2).map((e) => (
              <div key={e} className="flex items-center gap-1 text-sm capitalize">
                <span className="material-symbols-outlined text-base" aria-hidden="true">
                  {EQUIP_ICON[e.toLowerCase()] ?? "devices"}
                </span>
                {e}
              </div>
            ))}
          </div>

          {canBook ? (
            <button
              onClick={() => setDialogOpen(true)}
              className="w-full bg-secondary-container text-on-secondary-container py-2.5 rounded font-semibold text-sm border border-secondary/30 hover:bg-secondary hover:text-on-secondary transition-colors"
            >
              {bookLabel}
            </button>
          ) : (
            <Link
              href={`/rooms/${room.id}`}
              className="block w-full text-center border border-outline-variant text-on-surface-variant py-2.5 rounded text-sm hover:bg-surface-container transition-colors"
            >
              View Schedule
            </Link>
          )}

          <button
            onClick={() => setShowSchedule((v) => !v)}
            aria-expanded={showSchedule}
            className="mt-2 w-full flex items-center justify-center gap-1 py-1 text-xs text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">
              {showSchedule ? "expand_less" : "expand_more"}
            </span>
            {showSchedule ? "Hide" : "Today's schedule"}
          </button>

          {showSchedule && (
            <div className="mt-1 space-y-1 border-t pt-2">
              {todayBookings.length === 0 ? (
                <p className="py-1 text-center text-xs text-on-surface-variant">Free all day</p>
              ) : (
                todayBookings.map((b) => (
                  <div key={b.id} className="flex items-baseline justify-between text-xs">
                    <span className="text-on-surface-variant whitespace-nowrap">
                      {localTime(b.startUtc)}–{localTime(b.endUtc)}
                    </span>
                    {b.visibility === "full" && b.subject && (
                      <span className="ml-2 truncate text-on-surface max-w-[130px]">
                        {b.subject}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {canBook && (
        <BookingDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          roomId={room.id}
          roomName={room.displayName}
          roomKind={room.kind}
          date={filterDate}
          initialStart={filterStart}
          initialEnd={filterEnd}
          isAdmin={isAdmin}
        />
      )}
    </>
  );
}
