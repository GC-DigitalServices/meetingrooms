"use client";

import { useState, useEffect, useRef } from "react";
import { addDays, format, isToday } from "date-fns";
import BookingDialog from "./BookingDialog";
import CancelDialog from "./CancelDialog";
import { useRoomLive } from "@/hooks/useRoomLive";
import { computeRoomStatus } from "@/lib/booking/status";
import {
  freeUntilLabel,
  busyUntilLabel,
  bookedAtLabel,
  findNextFreeSlot,
} from "@/lib/booking/labels";
import { localTime, localDateISO, timeToMinutes, minutesToTime } from "@/lib/utils";
import type { BookingSlot } from "@/hooks/useRoomLive";

const DAY_START = 7 * 60; // 07:00 in minutes from midnight
const DAY_END = 22 * 60; // 22:00
const TOTAL_MIN = DAY_END - DAY_START;
const PX_PER_MIN = 48 / 60; // 48px per hour

function minToY(totalMinutes: number): number {
  return (totalMinutes - DAY_START) * PX_PER_MIN;
}

const TOTAL_H = TOTAL_MIN * PX_PER_MIN; // 720px

const STATUS_PILL: Record<string, { label: string; className: string }> = {
  free: { label: "Available", className: "bg-green-100 text-green-800" },
  busy: { label: "Busy", className: "bg-red-100 text-red-700" },
  soon: { label: "Booked soon", className: "bg-amber-100 text-amber-700" },
};

interface Room {
  id: string;
  displayName: string;
  kind: string;
}
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
  const [bookingSlot, setBookingSlot] = useState<{
    date: string;
    start: string;
    end: string;
  } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; roomName: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Drag-to-select (mouse only — touch drags must keep scrolling the grid)
  const [drag, setDrag] = useState<{ anchor: number; end: number } | null>(null);
  const tapAnchor = useRef<number | null>(null);

  const days = Array.from({ length: 7 }, (_, i) => addDays(new Date(), i));
  const activeDay = days[selectedDay];
  const activeDayStr = format(activeDay, "yyyy-MM-dd");
  const now = new Date();
  const nowMin = timeToMinutes(localTime(now));
  const showNow =
    selectedDay === 0 && isToday(activeDay) && nowMin >= DAY_START && nowMin <= DAY_END;

  useEffect(() => {
    if (!scrollRef.current) return;
    const y = selectedDay === 0 ? Math.max(0, minToY(Math.max(DAY_START, nowMin)) - 80) : 0;
    scrollRef.current.scrollTop = y;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay]);

  const dayBookings = bookings
    .filter((b) => localDateISO(b.startUtc) === activeDayStr)
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc));

  // Live status (about right now) + one-tap booking of the day's next free hour
  const status = computeRoomStatus(bookings, now);
  const pill = STATUS_PILL[status] ?? STATUS_PILL.free;
  const statusDetail =
    status === "busy"
      ? busyUntilLabel(bookings, now)
      : status === "soon"
        ? bookedAtLabel(bookings, now)
        : freeUntilLabel(bookings, now);
  const nextFree = canBook ? findNextFreeSlot(dayBookings, activeDayStr, 60) : null;

  function eventMinute(e: React.PointerEvent<HTMLDivElement>): number {
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = (e.clientY - rect.top) / PX_PER_MIN + DAY_START;
    const snapped = Math.round(raw / 15) * 15;
    return Math.max(DAY_START, Math.min(DAY_END, snapped));
  }

  function openSlot(startMin: number, endMin: number) {
    const start = Math.max(DAY_START, Math.min(DAY_END - 30, startMin));
    const end = Math.min(DAY_END, Math.max(endMin, start + 30));
    setBookingSlot({ date: activeDayStr, start: minutesToTime(start), end: minutesToTime(end) });
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!canBook) return;
    const m = eventMinute(e);
    if (e.pointerType === "mouse") {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ anchor: m, end: m });
    } else {
      // Touch: remember the tap; a scroll gesture fires pointercancel instead
      tapAnchor.current = m;
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse" || !drag) return;
    const m = eventMinute(e);
    if (m !== drag.end) setDrag({ ...drag, end: m });
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!canBook) return;
    if (e.pointerType === "mouse") {
      if (!drag) return;
      setDrag(null);
      const from = Math.min(drag.anchor, drag.end);
      const to = Math.max(drag.anchor, drag.end);
      // A plain click (no meaningful drag) books the classic one-hour slot
      if (to - from < 30) openSlot(from, from + 60);
      else openSlot(from, to);
    } else if (tapAnchor.current !== null) {
      const m = tapAnchor.current;
      tapAnchor.current = null;
      openSlot(m, m + 60);
    }
  }

  function handlePointerCancel() {
    setDrag(null);
    tapAnchor.current = null;
  }

  function dayTabLabel(i: number): string {
    const d = days[i];
    if (isToday(d)) return "Today";
    if (i === 1) return "Tomorrow";
    return format(d, "EEE d MMM");
  }

  const hours = Array.from({ length: (DAY_END - DAY_START) / 60 }, (_, i) => DAY_START / 60 + i);

  const dragTop = drag ? minToY(Math.min(drag.anchor, drag.end)) : 0;
  const dragHeight = drag ? Math.max(Math.abs(drag.end - drag.anchor) * PX_PER_MIN, 4) : 0;

  return (
    <>
      {/* Live status + quick book */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${pill.className}`}>
            {pill.label}
          </span>
          {statusDetail && <span className="text-sm text-on-surface-variant">{statusDetail}</span>}
        </div>
        {nextFree && (
          <button
            onClick={() =>
              setBookingSlot({ date: activeDayStr, start: nextFree.start, end: nextFree.end })
            }
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-on-primary text-sm font-semibold hover:bg-primary-container transition-colors"
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              bolt
            </span>
            Book {nextFree.start} – {nextFree.end}
          </button>
        )}
      </div>

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
      <div className="flex border border-surface-container-highest rounded-xl overflow-hidden bg-surface-container-lowest">
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
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
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
            {dayBookings.map((b) => {
              const startM = timeToMinutes(localTime(b.startUtc));
              const endRaw = timeToMinutes(localTime(b.endUtc));
              // A booking ending at exactly midnight reads as 0 minutes
              const endM = endRaw === 0 ? DAY_END : endRaw;
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
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="text-xs font-semibold leading-tight truncate">
                    {localTime(b.startUtc)}–{localTime(b.endUtc)}
                  </p>
                  {height > 36 && b.visibility === "full" && b.subject && (
                    <p className="text-xs truncate opacity-75 leading-tight">{b.subject}</p>
                  )}
                  {height > 36 && b.visibility === "busy" && (
                    <p className="text-xs italic opacity-50 leading-tight">Busy</p>
                  )}
                  {canCancel && (
                    <button
                      className="absolute top-0.5 right-0.5 p-1.5 rounded-full leading-none opacity-50 hover:opacity-100 hover:bg-black/10 transition-all"
                      aria-label={`Cancel booking ${localTime(b.startUtc)}–${localTime(b.endUtc)}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCancelTarget({ id: b.id, roomName: room.displayName });
                      }}
                    >
                      <span className="material-symbols-outlined text-sm block" aria-hidden="true">
                        close
                      </span>
                    </button>
                  )}
                </div>
              );
            })}

            {/* Drag selection overlay */}
            {drag && Math.abs(drag.end - drag.anchor) >= 15 && (
              <div
                className="absolute left-1.5 right-1.5 rounded-lg bg-primary/20 border-2 border-primary/60 pointer-events-none z-10 px-2 pt-1"
                style={{ top: dragTop, height: dragHeight }}
              >
                <p className="text-xs font-semibold text-primary">
                  {minutesToTime(Math.min(drag.anchor, drag.end))}–
                  {minutesToTime(Math.max(drag.anchor, drag.end))}
                </p>
              </div>
            )}

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
                <p className="text-sm text-on-surface-variant/40 italic">Tap any time to book</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {canBook && (
        <p className="mt-2 text-xs text-on-surface-variant flex items-center gap-1">
          <span className="material-symbols-outlined text-sm" aria-hidden="true">
            touch_app
          </span>
          Tap a free time to book an hour — with a mouse, drag to set the exact length.
        </p>
      )}

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
