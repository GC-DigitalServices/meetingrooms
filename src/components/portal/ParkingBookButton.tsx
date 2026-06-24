"use client";

import { useState } from "react";
import BookingDialog from "./BookingDialog";

interface Props {
  roomId: string;
  roomName: string;
  initialStart?: string;
  initialEnd?: string;
  filterDate?: string;
}

export function ParkingBookButton({ roomId, roomName, initialStart, initialEnd, filterDate }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 bg-secondary-container text-on-secondary-container px-5 py-2.5 rounded font-semibold text-sm border border-secondary/30 hover:bg-secondary hover:text-on-secondary transition-colors"
      >
        <span className="material-symbols-outlined text-base">local_parking</span>
        Book a Bay
      </button>

      <BookingDialog
        open={open}
        onClose={() => setOpen(false)}
        roomId={roomId}
        roomName={roomName}
        roomKind="PARKING"
        date={filterDate}
        initialStart={initialStart}
        initialEnd={initialEnd}
      />
    </>
  );
}
