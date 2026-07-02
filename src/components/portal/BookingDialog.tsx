"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// 08:00 – 20:00 in 15-minute steps
const TIME_OPTIONS = Array.from({ length: 49 }, (_, i) => {
  const m = 8 * 60 + i * 15;
  if (m > 20 * 60) return null;
  const h = String(Math.floor(m / 60)).padStart(2, "0");
  const min = String(m % 60).padStart(2, "0");
  return { value: `${h}:${min}` };
}).filter(Boolean) as { value: string }[];

/**
 * Convert a date string (YYYY-MM-DD) and local time (HH:mm, Europe/London)
 * to a UTC ISO string. Assumes the user's browser is set to Europe/London,
 * which is expected for all managed school devices.
 */
function toUTC(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

export interface BookingDialogProps {
  open: boolean;
  onClose: () => void;
  roomId: string;
  roomName: string;
  roomKind: string;
  /** YYYY-MM-DD — defaults to today if omitted */
  date?: string;
  /** HH:mm pre-fill */
  initialStart?: string;
  initialEnd?: string;
  onSuccess?: () => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function minDate(): string {
  return today();
}

function maxDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 90);
  return d.toISOString().slice(0, 10);
}

export default function BookingDialog({
  open,
  onClose,
  roomId,
  roomName,
  roomKind,
  date,
  initialStart = "09:00",
  initialEnd = "09:30",
  onSuccess,
}: BookingDialogProps) {
  const [selectedDate, setSelectedDate] = useState(date ?? today());
  const [endDate, setEndDate] = useState(date ?? today());
  const [startTime, setStartTime] = useState(initialStart);
  const [endTime, setEndTime] = useState(initialEnd);
  const [subject, setSubject] = useState("");
  const [premisesNotes, setPremisesNotes] = useState("");
  const [needAssistance, setNeedAssistance] = useState(false);
  const [assistanceNotes, setAssistanceNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [premisesError, setPremisesError] = useState<string | null>(null);
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [repeatWeeks, setRepeatWeeks] = useState(4);

  const isMinibus = roomKind === "MINIBUS";
  const isParking = roomKind === "PARKING" || roomKind === "PARKING_BAY";

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedDate(date ?? today());
      setEndDate(date ?? today());
      setStartTime(initialStart);
      setEndTime(initialEnd);
      setSubject("");
      setPremisesNotes("");
      setNeedAssistance(false);
      setAssistanceNotes("");
      setError(null);
      setConflictWarning(null);
      setPremisesError(null);
      setRepeatWeekly(false);
      setRepeatWeeks(4);
    }
  }, [open, date, initialStart, initialEnd]);

  // Inline conflict check — debounced 600ms after time/date changes
  useEffect(() => {
    if (!open) return;
    setConflictWarning(null);
    const from = toUTC(selectedDate, startTime);
    const to = toUTC(selectedDate, endTime);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        );
        if (!res.ok) return;
        const data = await res.json() as Record<string, { free: boolean }>;
        const info = data[roomId];
        if (info && !info.free) {
          setConflictWarning("This time slot is already booked.");
        }
      } catch { /* silently fail */ }
    }, 600);
    return () => clearTimeout(timer);
  }, [open, selectedDate, startTime, endTime, roomId]);

  // Keep endTime always after startTime (only when start and end are on the same day)
  useEffect(() => {
    if (endDate > selectedDate) return;
    const startIdx = TIME_OPTIONS.findIndex((t) => t.value === startTime);
    const endIdx = TIME_OPTIONS.findIndex((t) => t.value === endTime);
    if (endIdx <= startIdx) {
      const next = TIME_OPTIONS[Math.min(startIdx + 2, TIME_OPTIONS.length - 1)];
      setEndTime(next.value);
    }
  }, [startTime, endTime, selectedDate, endDate]);

  async function handleSubmit() {
    if (!isParking && !subject.trim()) {
      setError("Subject is required.");
      return;
    }
    if (isMinibus && !premisesNotes.trim()) {
      setError("Destination, number of passengers and driver name are required for minibus bookings.");
      return;
    }
    if (needAssistance && !assistanceNotes.trim()) {
      setError("Please describe what premises assistance you need.");
      return;
    }

    setSubmitting(true);
    setError(null);

    // Determine premises notes: minibus uses its own field; other rooms use assistance notes
    const finalPremisesNotes = isMinibus
      ? premisesNotes.trim() || null
      : needAssistance
      ? assistanceNotes.trim() || null
      : null;

    try {
      let ok = false;
      let errorMsg: string | null = null;

      if (repeatWeekly) {
        const res = await fetch("/api/bookings/recurring", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId,
            subject: subject.trim(),
            start: toUTC(selectedDate, startTime),
            end:   toUTC(isMinibus ? endDate : selectedDate, endTime),
            repeatWeeks,
            premisesNotes: finalPremisesNotes,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { created: unknown[]; skipped: unknown[]; aborted: boolean };
          const createdCount = data.created.length;
          const skippedCount = data.skipped.length;
          if (createdCount === 0) {
            errorMsg = "No bookings could be created — all weeks are already taken.";
          } else {
            ok = true;
            const msg = skippedCount > 0
              ? `${createdCount} of ${repeatWeeks} bookings created. ${skippedCount} week${skippedCount > 1 ? "s were" : " was"} already taken.`
              : `${createdCount} weekly booking${createdCount > 1 ? "s" : ""} created.`;
            toast.success(msg);
            if (data.aborted) toast.warning("Some weeks could not be created — calendar system temporarily unavailable.");
          }
        } else {
          const data = (await res.json()) as { error?: { message?: string } };
          errorMsg = data.error?.message ?? "Booking failed. Please try again.";
        }
      } else {
        const res = await fetch("/api/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId,
            subject: subject.trim(),
            start: toUTC(selectedDate, startTime),
            end:   toUTC(isMinibus ? endDate : selectedDate, endTime),
            premisesNotes: finalPremisesNotes,
          }),
        });
        if (res.ok) {
          ok = true;
          toast.success("Room booked successfully");
        } else {
          const data = (await res.json()) as { error?: { message?: string } };
          errorMsg = data.error?.message ?? "Booking failed. Please try again.";
        }
      }

      if (ok) {
        onSuccess?.();
        onClose();
      } else if (errorMsg) {
        setError(errorMsg);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const endOptions = (isMinibus && endDate > selectedDate)
    ? TIME_OPTIONS
    : TIME_OPTIONS.filter((t) => t.value > startTime);

  const repeatDates = repeatWeekly
    ? Array.from({ length: repeatWeeks }, (_, i) => {
        const d = new Date(selectedDate + "T12:00:00");
        d.setDate(d.getDate() + i * 7);
        return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
      })
    : [];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Book {roomName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {isMinibus ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="bd-date">Start date</Label>
                <input
                  id="bd-date"
                  type="date"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={selectedDate}
                  min={minDate()}
                  max={maxDate()}
                  disabled={submitting}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    if (endDate < e.target.value) setEndDate(e.target.value);
                  }}
                />
              </div>
              <div>
                <Label htmlFor="bd-start">Start time</Label>
                <select
                  id="bd-start"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={startTime}
                  disabled={submitting}
                  onChange={(e) => setStartTime(e.target.value)}
                >
                  {TIME_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.value}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="bd-enddate">End date</Label>
                <input
                  id="bd-enddate"
                  type="date"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={endDate}
                  min={selectedDate}
                  max={maxDate()}
                  disabled={submitting}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="bd-end">End time</Label>
                <select
                  id="bd-end"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={endTime}
                  disabled={submitting}
                  onChange={(e) => setEndTime(e.target.value)}
                >
                  {endOptions.map((t) => (
                    <option key={t.value} value={t.value}>{t.value}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <>
              <div>
                <Label htmlFor="bd-date">Date</Label>
                <input
                  id="bd-date"
                  type="date"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={selectedDate}
                  min={minDate()}
                  max={maxDate()}
                  disabled={submitting}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="bd-start">Start time</Label>
                  <select
                    id="bd-start"
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={startTime}
                    disabled={submitting}
                    onChange={(e) => setStartTime(e.target.value)}
                  >
                    {TIME_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.value}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="bd-end">End time</Label>
                  <select
                    id="bd-end"
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={endTime}
                    disabled={submitting}
                    onChange={(e) => setEndTime(e.target.value)}
                  >
                    {endOptions.map((t) => (
                      <option key={t.value} value={t.value}>{t.value}</option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {conflictWarning && (
            <p className="flex items-center gap-1 text-sm text-amber-600">
              <span className="material-symbols-outlined text-sm">warning</span>
              {conflictWarning}
            </p>
          )}

          {isParking ? (
            <div>
              <Label htmlFor="bd-subject">Notes (optional)</Label>
              <Input
                id="bd-subject"
                className="mt-1"
                placeholder="e.g. visitor name or purpose of visit"
                maxLength={100}
                value={subject}
                disabled={submitting}
                onChange={(e) => setSubject(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
            </div>
          ) : (
            <div>
              <Label htmlFor="bd-subject">
                Subject <span className="text-destructive">*</span>
              </Label>
              <Input
                id="bd-subject"
                className="mt-1"
                placeholder="e.g. Year 10 Physics"
                maxLength={100}
                value={subject}
                disabled={submitting}
                onChange={(e) => setSubject(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
            </div>
          )}

          {isMinibus && (
            <div>
              <Label htmlFor="bd-premises">
                Destination, passengers & driver <span className="text-destructive">*</span>
              </Label>
              <textarea
                id="bd-premises"
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm min-h-[72px] focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="e.g. Harrogate Leisure Centre — 12 students — Mr Smith"
                value={premisesNotes}
                disabled={submitting}
                onChange={(e) => {
                  setPremisesNotes(e.target.value);
                  if (premisesError && e.target.value.trim()) setPremisesError(null);
                }}
                onBlur={() => {
                  if (!premisesNotes.trim()) setPremisesError("Destination, passengers and driver name are required.");
                }}
              />
              {premisesError && <p className="mt-1 text-sm text-destructive">{premisesError}</p>}
            </div>
          )}

          {/* Premises assistance — shown for standard rooms only */}
          {!isMinibus && !isParking && (
            <div>
              <button
                type="button"
                onClick={() => setNeedAssistance((v) => !v)}
                disabled={submitting}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-label-md font-label-md transition-all ${
                  needAssistance
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-base">build</span>
                  Request premises assistance
                </span>
                <span className="material-symbols-outlined text-base">
                  {needAssistance ? "expand_less" : "expand_more"}
                </span>
              </button>

              {needAssistance && (
                <div className="mt-2 space-y-1">
                  <textarea
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm min-h-[80px] focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="e.g. Please set up the projector and arrange chairs in a horseshoe layout for 20 people"
                    value={assistanceNotes}
                    disabled={submitting}
                    onChange={(e) => setAssistanceNotes(e.target.value)}
                  />
                  <p className="text-label-sm font-label-sm text-on-surface-variant">
                    Premises staff will receive an email with these details, the room and time.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Repeat weekly — only for standard rooms */}
          {!isMinibus && !isParking && (
            <div>
              <button
                type="button"
                onClick={() => setRepeatWeekly((v) => !v)}
                disabled={submitting}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-label-md font-label-md transition-all ${
                  repeatWeekly
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-base">event_repeat</span>
                  Repeat weekly
                </span>
                <span className="material-symbols-outlined text-base">
                  {repeatWeekly ? "expand_less" : "expand_more"}
                </span>
              </button>

              {repeatWeekly && (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-label-sm font-label-sm text-on-surface-variant whitespace-nowrap">Number of weeks</label>
                    <select
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      value={repeatWeeks}
                      disabled={submitting}
                      onChange={(e) => setRepeatWeeks(Number(e.target.value))}
                    >
                      {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                        <option key={n} value={n}>{n} weeks</option>
                      ))}
                    </select>
                  </div>
                  <p className="text-label-sm font-label-sm text-on-surface-variant">
                    {repeatDates.join(" · ")}
                  </p>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || (!isParking && !subject.trim())}>
            {submitting ? "Booking…" : isParking ? "Book a bay" : "Book meeting room"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
