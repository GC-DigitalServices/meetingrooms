"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Search, Trash2, Bus, Car, DoorOpen } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type KindFilter = "ALL" | "ROOMS" | "MINIBUS" | "PARKING";

interface BookingRow {
  id: string;
  subject: string;
  organiserName: string;
  organiserUpn: string;
  startUtc: string;
  endUtc: string;
  isAllDay: boolean;
  premisesNotes: string | null;
  isRecurring: boolean;
  room: { id: string; displayName: string; kind: string; building: string | null };
}

const FILTERS: { value: KindFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "ROOMS", label: "Meeting rooms" },
  { value: "MINIBUS", label: "Minibus" },
  { value: "PARKING", label: "Visitor car park" },
];

function kindIcon(kind: string) {
  if (kind === "MINIBUS") return Bus;
  if (kind === "PARKING" || kind === "PARKING_BAY") return Car;
  return DoorOpen;
}

function kindLabel(kind: string): string {
  if (kind === "MINIBUS") return "Minibus";
  if (kind === "PARKING" || kind === "PARKING_BAY") return "Car park";
  return "Room";
}

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  dateStyle: "medium",
});
const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
});

function formatWhen(b: BookingRow): string {
  const start = new Date(b.startUtc);
  const end = new Date(b.endUtc);
  if (b.isAllDay) return `${dateFmt.format(start)} · All day`;

  const sameDay = dateFmt.format(start) === dateFmt.format(end);
  if (sameDay) {
    return `${dateFmt.format(start)} · ${timeFmt.format(start)}–${timeFmt.format(end)}`;
  }
  return `${dateFmt.format(start)} ${timeFmt.format(start)} → ${dateFmt.format(end)} ${timeFmt.format(end)}`;
}

/** Local calendar date (yyyy-mm-dd) → ISO instant at the given edge of that day. */
function dayBoundaryIso(date: string, edge: "start" | "end"): string {
  const d = new Date(`${date}T${edge === "start" ? "00:00:00" : "23:59:59"}`);
  return d.toISOString();
}

function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function BookingSearch() {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindFilter>("ALL");
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState("");

  const [rows, setRows] = useState<BookingRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Guards against a slow earlier request overwriting a newer result set.
  const reqSeq = useRef(0);

  const search = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (kind !== "ALL") params.set("kind", kind);
      if (from) params.set("from", dayBoundaryIso(from, "start"));
      if (to) params.set("to", dayBoundaryIso(to, "end"));

      const res = await fetch(`/api/admin/bookings?${params.toString()}`);
      const data = (await res.json()) as {
        bookings?: BookingRow[];
        truncated?: boolean;
        error?: { message?: string };
      };
      if (seq !== reqSeq.current) return; // a newer search has superseded this one
      if (!res.ok) {
        toast.error(data.error?.message ?? "Search failed");
        return;
      }
      setRows(data.bookings ?? []);
      setTruncated(Boolean(data.truncated));
    } catch {
      if (seq === reqSeq.current) toast.error("Network error. Please try again.");
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [q, kind, from, to]);

  // Debounce so typing in the search box doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(search, 250);
    return () => clearTimeout(t);
  }, [search]);

  async function handleDelete(b: BookingRow) {
    setDeletingId(b.id);
    try {
      const res = await fetch(`/api/bookings/${b.id}`, { method: "DELETE" });
      if (res.status === 204) {
        setRows((prev) => prev.filter((r) => r.id !== b.id));
        toast.success("Booking deleted");
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      toast.error(data?.error?.message ?? "Could not delete this booking");
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by subject, organiser or room…"
              className="pl-9"
              aria-label="Search bookings"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <Button
                key={f.value}
                type="button"
                size="sm"
                variant={kind === f.value ? "default" : "outline"}
                onClick={() => setKind(f.value)}
              >
                {f.label}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="from" className="text-xs">
                From
              </Label>
              <Input
                id="from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-auto"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="to" className="text-xs">
                To
              </Label>
              <Input
                id="to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-auto"
              />
            </div>
            {(from || to) && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setFrom("");
                  setTo("");
                }}
              >
                Clear dates
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Leave the dates empty to include past bookings.
          </p>
        </CardContent>
      </Card>

      {truncated && (
        <p className="text-xs text-amber-700">
          Showing the first 100 matches only — narrow the search to see the rest.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Searching…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No bookings match this search.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((b) => {
            const Icon = kindIcon(b.room.kind);
            return (
              <li key={b.id}>
                <Card>
                  <CardContent className="flex items-start justify-between gap-4 py-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-medium">{b.subject}</p>
                          <Badge variant="secondary" className="text-xs">
                            {kindLabel(b.room.kind)}
                          </Badge>
                          {b.isRecurring && (
                            <Badge variant="outline" className="text-xs">
                              Recurring
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {b.room.displayName}
                          {b.room.building ? ` · ${b.room.building}` : ""}
                        </p>
                        <p className="text-sm text-muted-foreground">{formatWhen(b)}</p>
                        <p className="text-xs text-muted-foreground">
                          {b.organiserName} ({b.organiserUpn})
                        </p>
                      </div>
                    </div>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-shrink-0 text-destructive hover:text-destructive"
                          disabled={deletingId === b.id}
                        >
                          <Trash2 className="mr-1 h-4 w-4" />
                          {deletingId === b.id ? "Deleting…" : "Delete"}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this booking?</AlertDialogTitle>
                          <AlertDialogDescription asChild>
                            <div className="space-y-2">
                              <p>
                                <strong>{b.subject}</strong> — {b.room.displayName}, {formatWhen(b)}
                                .
                              </p>
                              <p>
                                This cancels the booking in Exchange and notifies the organiser,{" "}
                                {b.organiserName}. It cannot be undone.
                              </p>
                              {b.isRecurring && (
                                <p>
                                  This is one occurrence of a repeating booking — the other
                                  occurrences are not affected.
                                </p>
                              )}
                            </div>
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(b)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete booking
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
