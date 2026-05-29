"use client";

import { useState } from "react";
import Link from "next/link";
import { Users, MapPin, Projector, Tv, Wifi } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
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

const EQUIP_ICON: Record<string, React.ReactNode> = {
  projector: <Projector className="h-3.5 w-3.5" />,
  tv: <Tv className="h-3.5 w-3.5" />,
  screen: <Tv className="h-3.5 w-3.5" />,
  wifi: <Wifi className="h-3.5 w-3.5" />,
  av: <Tv className="h-3.5 w-3.5" />,
};

export default function RoomCard({ room, bookings, canBook }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const status = computeRoomStatus(bookings);

  return (
    <>
      <Card className="flex flex-col hover:shadow-md transition-shadow">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base leading-snug">
              <Link href={`/rooms/${room.id}`} className="hover:underline">
                {room.displayName}
              </Link>
            </CardTitle>
            <StatusPill status={status} className="shrink-0" />
          </div>

          {(room.building || room.floor) && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <MapPin className="h-3 w-3" />
              {[room.building, room.floor].filter(Boolean).join(", ")}
            </div>
          )}
        </CardHeader>

        <CardContent className="pt-0 flex flex-col gap-3 flex-1">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {room.capacity}
            </span>
            {room.equipment.slice(0, 3).map((e) => (
              <span key={e} title={e} className="flex items-center gap-1">
                {EQUIP_ICON[e.toLowerCase()] ?? null}
                <span className="text-xs sr-only">{e}</span>
              </span>
            ))}
          </div>

          <div className="mt-auto">
            {canBook ? (
              <button
                onClick={() => setDialogOpen(true)}
                className="w-full rounded-md border border-primary text-primary text-sm py-1.5 hover:bg-primary hover:text-primary-foreground transition-colors"
              >
                Book
              </button>
            ) : (
              <p className="text-xs text-muted-foreground">Not permitted to book</p>
            )}
          </div>
        </CardContent>
      </Card>

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
