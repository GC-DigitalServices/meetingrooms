"use client";

import { useState, useEffect } from "react";
import { format, isAfter } from "date-fns";
import BookingDialog from "@/components/portal/BookingDialog";
import CancelDialog from "@/components/portal/CancelDialog";
import { localTime } from "@/lib/utils";

interface Minibus {
  id: string;
  displayName: string;
  capacity: number;
}

interface StatusBooking {
  id: string;
  roomId: string;
  startUtc: string;
  endUtc: string;
  subject: string | null;
  organiserName: string | null;
}

interface MyBooking {
  id: string;
  subject: string;
  startUtc: string;
  endUtc: string;
  premisesNotes: string | null;
  room: { id: string; displayName: string };
}

interface Props {
  minibuses: Minibus[];
  statusBookings: StatusBooking[];
  dayBookings: StatusBooking[];
  minibusIds: string[];
  isToday: boolean;
}

export default function MinibusClient({ minibuses, statusBookings, dayBookings, minibusIds, isToday }: Props) {
  const [bookingTarget, setBookingTarget] = useState<Minibus | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; roomName: string } | null>(null);
  const [myBookings, setMyBookings] = useState<MyBooking[] | null>(null);

  const idSet = new Set(minibusIds);

  async function loadMyBookings() {
    const res = await fetch("/api/bookings/mine");
    if (!res.ok) return;
    const all = (await res.json()) as MyBooking[];
    setMyBookings(all.filter((b) => idSet.has(b.room.id)));
  }

  useEffect(() => { void loadMyBookings(); }, []);

  const now = new Date();

  function busyNow(minibusId: string) {
    return statusBookings.some(
      (b) => b.roomId === minibusId && new Date(b.startUtc) <= now && new Date(b.endUtc) > now
    );
  }

  function nextStatusBooking(minibusId: string): StatusBooking | null {
    return (
      statusBookings
        .filter((b) => b.roomId === minibusId && new Date(b.startUtc) > now)
        .sort((a, b) => a.startUtc.localeCompare(b.startUtc))[0] ?? null
    );
  }

  function vehicleDayBookings(minibusId: string): StatusBooking[] {
    return dayBookings.filter((b) => b.roomId === minibusId);
  }

  const upcoming = (myBookings ?? [])
    .filter((b) => isAfter(new Date(b.endUtc), now))
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc));

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="font-display font-extrabold text-headline-xl text-on-background">Minibus Booking</h1>
      </div>

      {/* Vehicle list */}
      {minibuses.length === 0 ? (
        <div className="rounded-xl border border-surface-container-highest bg-white p-8 text-center">
          <span className="material-symbols-outlined text-5xl text-outline mb-3 block">directions_bus</span>
          <p className="text-body-md text-on-surface-variant">No minibuses are configured yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {minibuses.map((m) => {
            const busy = isToday && busyNow(m.id);
            const next = isToday ? nextStatusBooking(m.id) : null;
            const scheduleBookings = vehicleDayBookings(m.id);

            return (
              <div
                key={m.id}
                className="rounded-xl border border-surface-container-highest bg-white shadow-card overflow-hidden"
              >
                <div className="flex items-center justify-between gap-4 p-4">
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                        busy ? "bg-[var(--status-busy)]/10" : "bg-[var(--status-free)]/10"
                      }`}
                    >
                      <span
                        className={`material-symbols-outlined text-2xl ${
                          busy ? "text-[var(--status-busy)]" : "text-[var(--status-free)]"
                        }`}
                      >
                        directions_bus
                      </span>
                    </div>
                    <div>
                      <p className="font-medium text-on-background">{m.displayName}</p>
                      <p className="text-label-sm font-label-sm text-on-surface-variant mt-0.5">
                        {isToday
                          ? busy
                            ? "Currently out"
                            : next
                            ? `Available until ${localTime(next.startUtc)}`
                            : "Available"
                          : null}
                        {isToday && " · "}
                        {m.capacity} seats
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setBookingTarget(m)}
                    className="shrink-0 rounded-xl bg-primary px-4 py-2 text-label-md font-label-md text-on-primary hover:bg-primary/90 transition-colors"
                  >
                    Book
                  </button>
                </div>

                {/* Day schedule */}
                {scheduleBookings.length > 0 ? (
                  <div className="border-t border-surface-container-highest px-4 pb-3 pt-2 space-y-1">
                    {scheduleBookings.map((b) => (
                      <div key={b.id} className="flex items-center gap-3 text-sm">
                        <span className="material-symbols-outlined text-sm text-on-surface-variant">schedule</span>
                        <span className="text-on-surface-variant whitespace-nowrap">
                          {localTime(b.startUtc)}–{localTime(b.endUtc)}
                        </span>
                        <span className="text-on-surface truncate">
                          {b.subject || "Minibus booking"}
                          {b.organiserName ? ` · ${b.organiserName}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="border-t border-surface-container-highest px-4 pb-3 pt-2">
                    <p className="text-sm text-on-surface-variant">No bookings</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Upcoming trips — always shows the user's future bookings */}
      {upcoming.length > 0 && (
        <div>
          <h2 className="font-display font-semibold text-headline-md mb-3">Your upcoming trips</h2>
          <div className="space-y-2">
            {upcoming.map((b) => (
              <div
                key={b.id}
                className="rounded-xl border border-surface-container-highest bg-white px-4 py-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm text-on-background">{b.subject}</p>
                    <p className="text-label-sm font-label-sm text-on-surface-variant mt-0.5">
                      {b.room.displayName}
                      {" · "}
                      {format(new Date(b.startUtc), "EEE d MMM")}
                      {" · "}
                      {localTime(b.startUtc)}–{localTime(b.endUtc)}
                    </p>
                    {b.premisesNotes && (
                      <p className="text-label-sm font-label-sm text-on-surface-variant mt-1 italic">
                        {b.premisesNotes}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setCancelTarget({ id: b.id, roomName: b.room.displayName })}
                    className="shrink-0 text-xs text-on-surface-variant hover:text-destructive transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {bookingTarget && (
        <BookingDialog
          open
          onClose={() => setBookingTarget(null)}
          roomId={bookingTarget.id}
          roomName={bookingTarget.displayName}
          roomKind="MINIBUS"
          onSuccess={() => {
            setBookingTarget(null);
            void loadMyBookings();
          }}
        />
      )}

      {cancelTarget && (
        <CancelDialog
          open
          onClose={() => setCancelTarget(null)}
          bookingId={cancelTarget.id}
          roomName={cancelTarget.roomName}
          onSuccess={() => {
            setCancelTarget(null);
            void loadMyBookings();
          }}
        />
      )}
    </div>
  );
}
