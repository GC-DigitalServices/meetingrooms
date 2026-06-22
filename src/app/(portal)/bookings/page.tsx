"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format, isAfter, isBefore } from "date-fns";
import { MapPin, Clock } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import CancelDialog from "@/components/portal/CancelDialog";
import { localTime } from "@/lib/utils";
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
  const [cancelTarget, setCancelTarget] = useState<{ id: string; roomName: string } | null>(null);
  const [cancelRecurringTarget, setCancelRecurringTarget] = useState<{ groupId: string; roomName: string; count: number } | null>(null);
  const [cancellingAll, setCancellingAll] = useState(false);

  async function load() {
    const res = await fetch("/api/bookings/mine");
    if (res.ok) setBookings((await res.json()) as BookingRow[]);
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
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Could not cancel bookings");
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setCancellingAll(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const now = new Date();
  const upcoming = bookings?.filter((b) => isAfter(new Date(b.endUtc), now)) ?? [];
  const past = bookings?.filter((b) => isBefore(new Date(b.endUtc), now)) ?? [];

  const upcomingGroups = groupByDay(upcoming);
  const pastGroups = groupByDay(past).reverse();

  if (bookings === null) {
    return (
      <div className="max-w-xl space-y-4">
        <Skeleton className="h-6 w-48" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight mb-6">My Bookings</h1>

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
                    onCancel={() => setCancelTarget({ id: b.id, roomName: b.room.displayName })}
                    onCancelRemaining={
                      b.recurringGroupId
                        ? () => {
                            const count = upcoming.filter(u => u.recurringGroupId === b.recurringGroupId).length;
                            setCancelRecurringTarget({ groupId: b.recurringGroupId!, roomName: b.room.displayName, count });
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
          onSuccess={load}
        />
      )}

      {cancelRecurringTarget && (
        <AlertDialog open onOpenChange={(v) => !v && setCancelRecurringTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel all remaining bookings?</AlertDialogTitle>
              <AlertDialogDescription>
                This will cancel all {cancelRecurringTarget.count} remaining weekly booking{cancelRecurringTarget.count !== 1 ? "s" : ""} for <strong>{cancelRecurringTarget.roomName}</strong>. This cannot be undone.
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
        {!past && (onCancel || onCancelRemaining) && (
          <div className="flex flex-col items-end gap-1 shrink-0">
            {booking.recurringGroupId && (
              <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">Recurring</span>
            )}
            <div className="flex gap-2">
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
