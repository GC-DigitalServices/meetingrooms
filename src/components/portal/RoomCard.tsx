"use client";

import { useState } from "react";
import Link from "next/link";
import StatusPill from "./StatusPill";
import BookingDialog from "./BookingDialog";
import { computeRoomStatus } from "@/lib/booking/status";
import type { BookingSlot } from "@/hooks/useRoomLive";

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(new Date(iso));
}

function toLocalDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(iso));
}

interface Room {
  id: string;
  displayName: string;
  building: string | null;
  floor: string | null;
  capacity: number;
  equipment: string[];
  kind: string;
}

interface Props {
  room: Room;
  bookings: BookingSlot[];
  canBook: boolean;
  /** e.g. "Free until 14:30" or "Busy until 15:00" — shown below status */
  nextLabel?: string;
  /** Pre-fill dialog with the grid's selected date (YYYY-MM-DD) if set */
  filterDate?: string;
  filterStart?: string;
  filterEnd?: string;
  isFavourite?: boolean;
  onToggleFavourite?: () => void;
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

const KIND_GRADIENT: Record<string, string> = {
  STANDARD: "from-[#003a35] via-[#00534c] to-[#005f56]",
  COMPOSITE: "from-[#003a35] via-[#005049] to-[#003a35]",
  SECTION: "from-[#00534c] via-[#005049] to-[#003a35]",
  MINIBUS: "from-[#855300] via-[#965f00] to-[#633d00]",
};

const BUILDING_ICON: Record<string, string> = {
  Cooksey: "science",
  Dawson: "architecture",
};

export default function RoomCard({
  room,
  bookings,
  canBook,
  nextLabel,
  filterDate,
  filterStart,
  filterEnd,
  isFavourite,
  onToggleFavourite,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const status = computeRoomStatus(bookings);

  const scheduleDate = filterDate ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const todayBookings = bookings
    .filter((b) => toLocalDate(b.startUtc) === scheduleDate)
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  const gradient = KIND_GRADIENT[room.kind] ?? KIND_GRADIENT.STANDARD;
  const buildingIcon = (room.building && BUILDING_ICON[room.building]) ?? "meeting_room";

  const bookLabel = filterStart && filterEnd
    ? `Book ${filterStart} – ${filterEnd}`
    : "Reserve Meeting Room";

  return (
    <>
      <div className="group bg-white rounded-xl overflow-hidden border border-surface-container-highest shadow-card hover:shadow-card-hover transition-all duration-300">
        {/* Gradient image placeholder */}
        <Link href={`/rooms/${room.id}`} className="block relative h-44 overflow-hidden">
          <div className={`absolute inset-0 bg-gradient-to-br ${gradient} group-hover:scale-105 transition-transform duration-500`} />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
            <span className="material-symbols-outlined text-5xl opacity-70">{buildingIcon}</span>
            {room.building && (
              <span className="text-label-sm font-label-sm text-white/60 uppercase tracking-widest">
                {room.building}{room.floor ? ` · ${room.floor}` : ""}
              </span>
            )}
          </div>
          {/* Favourite star button */}
          {onToggleFavourite && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavourite(); }}
              className="absolute top-3 left-3 z-10 p-1.5 rounded-full transition-colors bg-black/10 hover:bg-black/30"
              aria-label={isFavourite ? "Remove from favourites" : "Add to favourites"}
            >
              <span className={`material-symbols-outlined text-sm ${isFavourite ? "text-yellow-300" : "text-white/50"}`}>
                {isFavourite ? "star" : "star_outline"}
              </span>
            </button>
          )}
          <div className="absolute top-3 right-3">
            <StatusPill status={status} />
          </div>
        </Link>

        {/* Card body */}
        <div className="p-md">
          <Link
            href={`/rooms/${room.id}`}
            className="font-display font-semibold text-headline-md text-on-background hover:text-primary transition-colors leading-tight block mb-1"
          >
            {room.displayName}
          </Link>

          {/* Next booking info */}
          {nextLabel && (
            <p className="text-label-sm font-label-sm text-on-surface-variant mb-2 flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">schedule</span>
              {nextLabel}
            </p>
          )}

          <div className="flex flex-wrap gap-md mb-md text-on-surface-variant">
            <div className="flex items-center gap-xs text-label-md font-label-md">
              <span className="material-symbols-outlined text-base">groups</span>
              {room.capacity} {room.capacity === 1 ? "person" : "people"}
            </div>
            {room.equipment.slice(0, 2).map(e => (
              <div key={e} className="flex items-center gap-xs text-label-md font-label-md capitalize">
                <span className="material-symbols-outlined text-base">{EQUIP_ICON[e.toLowerCase()] ?? "devices"}</span>
                {e}
              </div>
            ))}
          </div>

          {canBook ? (
            <button
              onClick={() => setDialogOpen(true)}
              className="w-full bg-secondary-container text-on-secondary-container py-3 rounded-xl font-bold text-label-md hover:opacity-90 active:scale-95 transition-all"
            >
              {bookLabel}
            </button>
          ) : (
            <Link
              href={`/rooms/${room.id}`}
              className="block w-full text-center border border-outline-variant text-on-surface-variant py-3 rounded-xl font-label-md hover:bg-surface-container transition-colors"
            >
              View Schedule
            </Link>
          )}

          <button
            onClick={() => setShowSchedule((v) => !v)}
            className="mt-2 w-full flex items-center justify-center gap-1 py-1 text-xs text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-sm">
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
                      {fmtTime(b.startUtc)}–{fmtTime(b.endUtc)}
                    </span>
                    {b.visibility === "full" && b.subject && (
                      <span className="ml-2 truncate text-on-surface max-w-[130px]">{b.subject}</span>
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
        />
      )}
    </>
  );
}
