"use client";

import { useState } from "react";
import Link from "next/link";
import BookingDialog from "./BookingDialog";
import { computeRoomStatus } from "@/lib/booking/status";
import type { BookingSlot } from "@/hooks/useRoomLive";

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
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
  nextLabel?: string;
  filterDate?: string;
  filterStart?: string;
  filterEnd?: string;
  isFavourite?: boolean;
  onToggleFavourite?: () => void;
}

const EQUIP_ICON: Record<string, string> = {
  projector: "videocam", tv: "tv", screen: "tv", wifi: "wifi",
  av: "speaker", whiteboard: "draw", pc: "computer", computers: "computer",
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

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  free: { label: "Available", className: "bg-green-100 text-green-800" },
  busy: { label: "Busy", className: "bg-red-100 text-red-700" },
  soon: { label: "Soon", className: "bg-amber-100 text-amber-700" },
};

export default function RoomCard({
  room, bookings, canBook, nextLabel,
  filterDate, filterStart, filterEnd,
  isFavourite, onToggleFavourite,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const status = computeRoomStatus(bookings);
  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.free;

  const scheduleDate = filterDate ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const todayBookings = bookings
    .filter(b => toLocalDate(b.startUtc) === scheduleDate)
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc));

  const buildingIcon = (room.building && BUILDING_ICON[room.building]) ?? "meeting_room";
  const bookLabel = filterStart && filterEnd ? `Book ${filterStart} – ${filterEnd}` : "Book Room";

  return (
    <>
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-card hover:shadow-card-hover hover:scale-[1.02] transition-all duration-200 overflow-hidden">
        {/* Card header */}
        <Link href={`/rooms/${room.id}`} className="block relative h-44 bg-primary-container overflow-hidden">
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
            <span className="material-symbols-outlined text-5xl text-on-primary/60">{buildingIcon}</span>
            <span className="text-xs text-on-primary/50 uppercase tracking-widest font-medium">
              {room.building ?? ""}{room.floor ? ` · ${room.floor}` : ""}
            </span>
          </div>
          {/* Status badge — top right */}
          <div className="absolute top-3 right-3">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${badge.className}`}>
              {badge.label}
            </span>
          </div>
          {/* Favourite — top left */}
          {onToggleFavourite && (
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); onToggleFavourite(); }}
              className="absolute top-3 left-3 p-1.5 rounded-full bg-black/10 hover:bg-black/25 transition-colors"
              aria-label={isFavourite ? "Remove from favourites" : "Add to favourites"}
            >
              <span className={`material-symbols-outlined text-sm ${isFavourite ? "filled text-secondary-fixed" : "text-white/60"}`}>
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
              <span className="material-symbols-outlined text-sm">schedule</span>
              {nextLabel}
            </p>
          )}

          <div className="flex flex-wrap gap-4 mb-4 text-on-surface-variant">
            <div className="flex items-center gap-1 text-sm">
              <span className="material-symbols-outlined text-base">groups</span>
              {room.capacity} {room.capacity === 1 ? "person" : "people"}
            </div>
            {room.equipment.slice(0, 2).map(e => (
              <div key={e} className="flex items-center gap-1 text-sm capitalize">
                <span className="material-symbols-outlined text-base">{EQUIP_ICON[e.toLowerCase()] ?? "devices"}</span>
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
            onClick={() => setShowSchedule(v => !v)}
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
                todayBookings.map(b => (
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
