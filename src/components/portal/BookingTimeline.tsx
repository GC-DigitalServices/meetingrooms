"use client";

import { useState } from "react";
import { addDays, format, isToday, isTomorrow, startOfDay } from "date-fns";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import StatusPill from "./StatusPill";
import BookingDialog from "./BookingDialog";
import CancelDialog from "./CancelDialog";
import { useRoomLive } from "@/hooks/useRoomLive";
import { computeRoomStatus } from "@/lib/booking/status";
import { localTime } from "@/lib/utils";
import type { BookingSlot } from "@/hooks/useRoomLive";

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

function dayLabel(d: Date): string {
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  return format(d, "EEE d MMM");
}

export default function BookingTimeline({ room, initialBookings, canBook, viewerUpn, isAdmin }: Props) {
  const bookings = useRoomLive(room.id, initialBookings);
  const [bookingDate, setBookingDate] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; roomName: string } | null>(null);

  const days = Array.from({ length: 7 }, (_, i) => addDays(startOfDay(new Date()), i));
  const now = new Date();

  return (
    <>
      <div className="space-y-6">
        {days.map((day) => {
          const dayStr = format(day, "yyyy-MM-dd");
          const dayBookings = bookings
            .filter((b) => localTime(b.startUtc).slice(0, 2) && b.startUtc.slice(0, 10) === dayStr)
            .sort((a, b) => a.startUtc.localeCompare(b.startUtc));

          const dayStatus = computeRoomStatus(dayBookings, isToday(day) ? now : day);

          return (
            <div key={dayStr}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <h3 className="font-medium">{dayLabel(day)}</h3>
                  {isToday(day) && <StatusPill status={dayStatus} />}
                </div>
                {canBook && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-muted-foreground"
                    onClick={() => setBookingDate(dayStr)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Book
                  </Button>
                )}
              </div>

              {dayBookings.length === 0 ? (
                <p className="text-sm text-muted-foreground">No bookings</p>
              ) : (
                <div className="space-y-2">
                  {dayBookings.map((b) => {
                    const isOwn = b.organiserUpn === viewerUpn;
                    const canModify = isOwn || isAdmin;

                    return (
                      <div
                        key={b.id}
                        className={`rounded-md border px-3 py-2 text-sm ${
                          isOwn ? "border-primary/40 bg-primary/5" : "bg-muted/40"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="font-medium tabular-nums">
                              {localTime(b.startUtc)}–{localTime(b.endUtc)}
                            </span>
                            {b.visibility === "full" && b.subject && (
                              <span className="ml-2 text-muted-foreground">{b.subject}</span>
                            )}
                            {b.visibility === "busy" && (
                              <span className="ml-2 text-muted-foreground italic">Busy</span>
                            )}
                          </div>
                          {canModify && (
                            <button
                              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                              onClick={() => setCancelTarget({ id: b.id, roomName: room.displayName })}
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                        {b.visibility === "full" && b.organiserName && (
                          <p className="text-xs text-muted-foreground mt-0.5">{b.organiserName}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <Separator className="mt-4" />
            </div>
          );
        })}
      </div>

      {bookingDate && canBook && (
        <BookingDialog
          open
          onClose={() => setBookingDate(null)}
          roomId={room.id}
          roomName={room.displayName}
          roomKind={room.kind}
          date={bookingDate}
          isAdmin={isAdmin}
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
