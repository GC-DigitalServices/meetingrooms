"use client";

import { useState, useEffect, useRef } from "react";
import { addDays, format, isToday } from "date-fns";
import BookingDialog from "./BookingDialog";
import CancelDialog from "./CancelDialog";
import { useRoomLive } from "@/hooks/useRoomLive";
import type { BookingSlot } from "@/hooks/useRoomLive";

const DAY_START = 7 * 60;    // 07:00 in minutes from midnight
const DAY_END = 22 * 60;     // 22:00
const TOTAL_MIN = DAY_END - DAY_START;
const PX_PER_MIN = 48 / 60; // 48px per hour

function minToY(totalMinutes: number): number {
  return (totalMinutes - DAY_START) * PX_PER_MIN;
}

const TOTAL_H = TOTAL_MIN * PX_PER_MIN; // 720px

function fmtHM(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
  }).format(new Date(iso));
}

interface Room { id: string; displayName: string; kind: string }
interface Props {
  room: Room;
  initialBookings: BookingSlot[];
  canBook: boolean;
  viewerUpn: string;
  isAdmin: boolean;
}

export default function DayTimeline({ room, initialBookings, canBook, viewerUpn, isAdmin }: Props) {
  const bookings = useRoomLive(room.id, initialBookings);
  const [selectedDay, setSelectedDay] = useState(0);
  const [bookingSlot, setBookingSlot] = useState<{ date: string; start: string; end: string } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; roomName: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const days = Array.from({ length: 7 }, (_, i) => addDays(new Date(), i));
  const activeDay = days[selectedDay];
  const activeDayStr = format(activeDay, "yyyy-MM-dd");
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const showNow = selectedDay === 0 && isToday(activeDay) && nowMin >= DAY_START && nowMin <= DAY_END;

  useEffect(() => {
    if (!scrollRef.current) return;
    const y = selectedDay === 0
      ? Math.max(0, minToY(Math.max(DAY_START, nowMin)) - 80)
      : 0;
    scrollRef.current.scrollTop = y;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay]);

  const dayBookings = bookings
    .filter(b => b.startUtc.startsWith(activeDayStr))
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc));

  function handleGridClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!canBook) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const clickedMin = y / PX_PER_MIN + DAY_START;
    const snapped = Math.round(clickedMin / 15) * 15;
    const startMin = Math.max(DAY_START, Math.min(DAY_END - 30, snapped));
    const endMin = Math.min(DAY_END, startMin + 60);
    const fmt = (m: number) =>
      `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    setBookingSlot({ date: activeDayStr, start: fmt(startMin), end: fmt(endMin) });
  }

  function dayTabLabel(i: number): string {
    const d = days[i];
    if (isToday(d)) return "Today";
    if (i === 1) return "Tomorrow";
    return format(d, "EEE d MMM");
  }

  const hours = Array.from({ length: (DAY_END - DAY_START) / 60 }, (_, i) => DAY_START / 60 + i);

  return (
    <>
      {/* Day tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {days.map((_, i) => (
          <button
            key={i}
            onClick={() => setSelectedDay(i)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors shrink-0 ${
              selectedDay === i
                ? "bg-primary text-on-primary"
                : "text-on-surface-variant hover:bg-surface-container"
            }`}
          >
            {dayTabLabel(i)}
          </button>
        ))}
      </div>

      {/* Timeline wrapper */}
      <div className="flex border border-surface-container-highest rounded-xl overflow-hidden bg-white">
        {/* Hour labels column */}
        <div className="w-14 shrink-0 border-r border-surface-container-highest bg-surface-container/30 overflow-hidden">
          <div style={{ height: TOTAL_H }} className="relative">
            {hours.map((h, i) => (
              <div
                key={h}
                className="absolute w-full pr-2 text-right text-xs text-on-surface-variant leading-none"
                style={{ top: i * 48 - 6 }}
              >
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>
        </div>

        {/* Scrollable grid */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto" style={{ maxHeight: 504 }}>
          <div
            className={`relative${canBook ? " cursor-crosshair" : ""}`}
            style={{ height: TOTAL_H }}
            onClick={handleGridClick}
          >
            {/* Hour lines */}
            {hours.map((_, i) => (
              <div
                key={i}
                className="absolute left-0 right-0 border-t border-surface-container-highest"
                style={{ top: i * 48 }}
              />
            ))}
            {/* Half-hour lines */}
            {hours.map((_, i) => (
              <div
                key={`h${i}`}
                className="absolute left-0 right-0 border-t border-surface-container-highest/40"
                style={{ top: i * 48 + 24 }}
              />
            ))}

            {/* Booking blocks */}
            {dayBookings.map(b => {
              const bStart = new Date(b.startUtc);
              const bEnd = new Date(b.endUtc);
              const startM = bStart.getHours() * 60 + bStart.getMinutes();
              const endM = bEnd.getHours() * 60 + bEnd.getMinutes();
              const top = minToY(Math.max(startM, DAY_START));
              const height = Math.max(20, minToY(Math.min(endM, DAY_END)) - top);
              const isOwn = b.organiserUpn === viewerUpn;
              const canCancel = isOwn || isAdmin;
              return (
                <div
                  key={b.id}
                  className={`absolute left-1.5 right-1.5 rounded-lg px-2 pt-1 pb-0.5 overflow-hidden select-none border ${
                    isOwn
                      ? "bg-primary/15 border-primary/50 text-primary"
                      : "bg-surface-container border-surface-container-high text-on-surface-variant"
                  }`}
                  style={{ top, height }}
                  onClick={e => e.stopPropagation()}
                >
                  <p className="text-xs font-semibold leading-tight truncate">
                    {fmtHM(b.startUtc)}–{fmtHM(b.endUtc)}
                  </p>
                  {height > 36 && b.visibility === "full" && b.subject && (
                    <p className="text-xs truncate opacity-75 leading-tight">{b.subject}</p>
                  )}
                  {height > 36 && b.visibility === "busy" && (
                    <p className="text-xs italic opacity-50 leading-tight">Busy</p>
                  )}
                  {canCancel && (
                    <button
                      className="absolute top-0.5 right-1 text-sm leading-none opacity-40 hover:opacity-100 transition-opacity"
                      onClick={e => { e.stopPropagation(); setCancelTarget({ id: b.id, roomName: room.displayName }); }}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}

            {/* Now line */}
            {showNow && (
              <div
                className="absolute left-0 right-0 z-10 pointer-events-none flex items-center"
                style={{ top: minToY(nowMin) }}
              >
                <div className="h-2.5 w-2.5 rounded-full bg-red-500 shrink-0 -ml-1" />
                <div className="flex-1 h-px bg-red-500" />
              </div>
            )}

            {/* Empty state */}
            {canBook && dayBookings.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-sm text-on-surface-variant/40 italic">Click any slot to book</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {canBook && bookingSlot && (
        <BookingDialog
          open
          onClose={() => setBookingSlot(null)}
          roomId={room.id}
          roomName={room.displayName}
          roomKind={room.kind}
          date={bookingSlot.date}
          initialStart={bookingSlot.start}
          initialEnd={bookingSlot.end}
        />
      )}
      {cancelTarget && (
        <CancelDialog
          open
          onClose={() => setCancelTarget(null)}
          bookingId={cancelTarget.id}
          roomName={cancelTarget.roomName}
        />
      )}
    </>
  );
}
