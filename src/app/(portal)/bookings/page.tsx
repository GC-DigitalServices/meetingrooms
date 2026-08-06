"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format, isAfter, isBefore } from "date-fns";
import { MapPin, Clock, CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import CancelDialog from "@/components/portal/CancelDialog";
import { localTime } from "@/lib/utils";
import { buildIcs } from "@/lib/ics";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface BookingRow {
  id: string;
  subject: string;
  startUtc: string;
  endUtc: string;
  recurringGroupId: string | null;
  room: { id: string; displayName: string; building: string | null };
}

// The portal is the only system that can write to room calendars, so give
// users a standards-based way to get the booking into their own calendar.
function downloadIcs(b: BookingRow) {
  const ics = buildIcs({
    uid: `${b.id}@meetingrooms.greenhead.ac.uk`,
    startUtc: b.startUtc,
    endUtc: b.endUtc,
    summary: b.subject || `Room booking — ${b.room.displayName}`,
    location: [b.room.displayName, b.room.building].filter(Boolean).join(", "),
  });
  const blob = new Blob([ics], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `booking-${b.startUtc.slice(0, 10)}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

function groupByDay(bookings: BookingRow[]): [string, BookingRow[]][] {
  const map = new Map<string, BookingRow[]>();
  for (const b of bookings) {
    const day = b.startUtc.slice(0, 10);
    (map.get(day) ?? map.set(day, []).get(day)!).push(b);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export default function MyBookingsPage() {
  const [bookings, setBookings] = useState<BookingRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{
    id: string;
    roomName: string;
    roomId: string;
  } | null>(null);
  const [cancelRecurringTarget, setCancelRecurringTarget] = useState<{
    groupId: string;
    roomName: string;
    count: number;
  } | null>(null);
  const [cancellingAll, setCancellingAll] = useState(false);

  async function load() {
    setLoadError(false);
    try {
      const res = await fetch("/api/bookings/mine");
      if (res.ok) setBookings((await res.json()) as BookingRow[]);
      else setLoadError(true);
    } catch {
      setLoadError(true);
    }
  }

  async function handleCancelRemaining(groupId: string) {
    setCancellingAll(true);
    try {
      const res = await fetch(`/api/bookings/recurring/${groupId}`, { method: "DELETE" });
      if (res.ok) {
        const data = (await res.json()) as { cancelled: number };
        toast.success(`${data.cancelled} booking${data.cancelled !== 1 ? "s" : ""} cancelled`);
        setCancelRecurringTarget(null);
        void load();
      } else {
        const data = (await res.json()) as { error?: { message?: string } };
        toast.error(data.error?.message ?? "Could not cancel bookings");
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setCancellingAll(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const now = new Date();
  const upcoming = bookings?.filter((b) => isAfter(new Date(b.endUtc), now)) ?? [];
  const past = bookings?.filter((b) => isBefore(new Date(b.endUtc), now)) ?? [];

  const upcomingGroups = groupByDay(upcoming);
  const pastGroups = groupByDay(past).reverse();

  // One page shell for all three states so the header doesn't jump between
  // error, loading and loaded renders.
  if (bookings === null) {
    return (
      <div className="px-margin-mobile md:px-margin-desktop pt-lg pb-lg">
        <div className="max-w-xl">
          <h1 className="font-display font-extrabold text-headline-xl text-on-background mb-6">
            My Bookings
          </h1>
          {loadError ? (
            <div className="rounded-xl border border-outline-variant/30 p-6 text-center">
              <p className="text-sm text-muted-foreground mb-4">
                Couldn&apos;t load your bookings. Check your connection and try again.
              </p>
              <button
                onClick={() => void load()}
                className="px-4 py-2 text-sm rounded-full bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity"
              >
                Try again
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-lg" />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-lg pb-lg">
      <div className="max-w-xl">
        <h1 className="font-display font-extrabold text-headline-xl text-on-background mb-6">
          My Bookings
        </h1>

        {upcomingGroups.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No upcoming bookings.{" "}
            <Link href="/" className="text-primary underline-offset-2 hover:underline">
              Find a room
            </Link>
          </p>
        ) : (
          <div className="space-y-6">
            {upcomingGroups.map(([day, dayBookings]) => (
              <div key={day}>
                <h2 className="text-sm font-medium text-muted-foreground mb-3">
                  {format(new Date(day), "EEEE d MMMM yyyy")}
                </h2>
                <div className="space-y-2">
                  {dayBookings.map((b) => (
                    <BookingRow
                      key={b.id}
                      booking={b}
                      onCancel={() =>
                        setCancelTarget({
                          id: b.id,
                          roomName: b.room.displayName,
                          roomId: b.room.id,
                        })
                      }
                      onCancelRemaining={
                        b.recurringGroupId
                          ? () => {
                              const count = upcoming.filter(
                                (u) => u.recurringGroupId === b.recurringGroupId,
                              ).length;
                              setCancelRecurringTarget({
                                groupId: b.recurringGroupId!,
                                roomName: b.room.displayName,
                                count,
                              });
                            }
                          : undefined
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {pastGroups.length > 0 && (
          <>
            <Separator className="my-8" />
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground select-none">
                Past bookings ({past.length})
              </summary>
              <div className="mt-4 space-y-6">
                {pastGroups.map(([day, dayBookings]) => (
                  <div key={day}>
                    <h2 className="text-sm font-medium text-muted-foreground mb-3">
                      {format(new Date(day), "EEEE d MMMM yyyy")}
                    </h2>
                    <div className="space-y-2">
                      {dayBookings.map((b) => (
                        <BookingRow key={b.id} booking={b} past />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </>
        )}

        {cancelTarget && (
          <CancelDialog
            open
            onClose={() => setCancelTarget(null)}
            bookingId={cancelTarget.id}
            roomName={cancelTarget.roomName}
            roomId={cancelTarget.roomId}
            onSuccess={load}
          />
        )}

        {cancelRecurringTarget && (
          <AlertDialog open onOpenChange={(v) => !v && setCancelRecurringTarget(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel all remaining bookings?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will cancel all {cancelRecurringTarget.count} remaining weekly booking
                  {cancelRecurringTarget.count !== 1 ? "s" : ""} for{" "}
                  <strong>{cancelRecurringTarget.roomName}</strong>. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={cancellingAll}>Keep bookings</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => handleCancelRemaining(cancelRecurringTarget.groupId)}
                  disabled={cancellingAll}
                >
                  {cancellingAll ? "Cancelling…" : "Yes, cancel all"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}

function BookingRow({
  booking,
  past,
  onCancel,
  onCancelRemaining,
}: {
  booking: BookingRow;
  past?: boolean;
  onCancel?: () => void;
  onCancelRemaining?: () => void;
}) {
  return (
    <div className={`rounded-md border px-4 py-3 ${past ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-sm">{booking.subject}</p>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              <Link href={`/rooms/${booking.room.id}`} className="hover:underline">
                {booking.room.displayName}
              </Link>
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {localTime(booking.startUtc)}–{localTime(booking.endUtc)}
            </span>
          </div>
        </div>
        {!past && (
          <div className="flex flex-col items-end gap-1 shrink-0">
            {booking.recurringGroupId && (
              <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                Recurring
              </span>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => downloadIcs(booking)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                title="Download an .ics file to add this booking to your own calendar"
              >
                <CalendarPlus className="h-3 w-3" aria-hidden="true" />
                Add to calendar
              </button>
              {onCancelRemaining && (
                <button
                  onClick={onCancelRemaining}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                >
                  Cancel remaining
                </button>
              )}
              {onCancel && (
                <button
                  onClick={onCancel}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
