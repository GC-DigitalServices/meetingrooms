"use client";

import { useState } from "react";
import Link from "next/link";
import StatusPill from "./StatusPill";
import BookingDialog from "./BookingDialog";
import { computeRoomStatus } from "@/lib/booking/status";
import type { BookingSlot } from "@/hooks/useRoomLive";

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
}

// Equipment icon mapping (Material Symbols)
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

// Gradient per room kind — placeholder for rooms without photos
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

export default function RoomCard({ room, bookings, canBook }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const status = computeRoomStatus(bookings);
  const gradient = KIND_GRADIENT[room.kind] ?? KIND_GRADIENT.STANDARD;
  const buildingIcon = (room.building && BUILDING_ICON[room.building]) ?? "meeting_room";

  return (
    <>
      <div className="group bg-white rounded-xl overflow-hidden border border-surface-container-highest shadow-card hover:shadow-card-hover transition-all duration-300">
        {/* Image / gradient placeholder */}
        <Link href={`/rooms/${room.id}`} className="block relative h-44 overflow-hidden">
          <div
            className={`absolute inset-0 bg-gradient-to-br ${gradient} group-hover:scale-105 transition-transform duration-500`}
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
            <span className="material-symbols-outlined text-5xl opacity-70">{buildingIcon}</span>
            {room.building && (
              <span className="text-label-sm font-label-sm text-white/60 uppercase tracking-widest">
                {room.building}
                {room.floor ? ` · ${room.floor}` : ""}
              </span>
            )}
          </div>
          {/* Status badge overlaid on image */}
          <div className="absolute top-3 right-3">
            <StatusPill status={status} />
          </div>
        </Link>

        {/* Card body */}
        <div className="p-md">
          <div className="mb-2">
            <Link
              href={`/rooms/${room.id}`}
              className="font-display font-semibold text-headline-md text-on-background hover:text-primary transition-colors leading-tight"
            >
              {room.displayName}
            </Link>
          </div>

          <div className="flex flex-wrap gap-md mb-md text-on-surface-variant">
            <div className="flex items-center gap-xs text-label-md font-label-md">
              <span className="material-symbols-outlined text-base">groups</span>
              {room.capacity} {room.capacity === 1 ? "person" : "people"}
            </div>
            {room.equipment.slice(0, 2).map((e) => (
              <div key={e} className="flex items-center gap-xs text-label-md font-label-md capitalize">
                <span className="material-symbols-outlined text-base">
                  {EQUIP_ICON[e.toLowerCase()] ?? "devices"}
                </span>
                {e}
              </div>
            ))}
          </div>

          {canBook ? (
            <button
              onClick={() => setDialogOpen(true)}
              className="w-full bg-secondary-container text-on-secondary-container py-3 rounded-xl font-bold text-label-md hover:opacity-90 active:scale-95 transition-all"
            >
              Reserve Room
            </button>
          ) : (
            <Link
              href={`/rooms/${room.id}`}
              className="block w-full text-center border border-outline-variant text-on-surface-variant py-3 rounded-xl font-label-md hover:bg-surface-container transition-colors"
            >
              View Schedule
            </Link>
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
        />
      )}
    </>
  );
}
