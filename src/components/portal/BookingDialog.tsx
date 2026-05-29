"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
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
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm pre-fill */
  initialStart?: string;
  initialEnd?: string;
  onSuccess?: () => void;
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
  const [startTime, setStartTime] = useState(initialStart);
  const [endTime, setEndTime] = useState(initialEnd);
  const [subject, setSubject] = useState("");
  const [premisesNotes, setPremisesNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMinibus = roomKind === "MINIBUS";

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStartTime(initialStart);
      setEndTime(initialEnd);
      setSubject("");
      setPremisesNotes("");
      setError(null);
    }
  }, [open, initialStart, initialEnd]);

  // Keep endTime always after startTime
  useEffect(() => {
    const startIdx = TIME_OPTIONS.findIndex((t) => t.value === startTime);
    const endIdx = TIME_OPTIONS.findIndex((t) => t.value === endTime);
    if (endIdx <= startIdx) {
      const next = TIME_OPTIONS[Math.min(startIdx + 2, TIME_OPTIONS.length - 1)];
      setEndTime(next.value);
    }
  }, [startTime, endTime]);

  async function handleSubmit() {
    if (!subject.trim()) {
      setError("Subject is required.");
      return;
    }
    if (isMinibus && !premisesNotes.trim()) {
      setError("Destination, number of passengers and driver name are required for minibus bookings.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          subject: subject.trim(),
          start: toUTC(date, startTime),
          end: toUTC(date, endTime),
          premisesNotes: premisesNotes.trim() || null,
        }),
      });

      if (res.ok) {
        toast.success("Room booked successfully");
        onSuccess?.();
        onClose();
      } else {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Booking failed. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const endOptions = TIME_OPTIONS.filter((t) => t.value > startTime);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Book {roomName}</DialogTitle>
          <DialogDescription>
            {new Date(date).toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bd-start">Start time</Label>
              <select
                id="bd-start"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.value}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="bd-end">End time</Label>
              <select
                id="bd-end"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              >
                {endOptions.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.value}
                  </option>
                ))}
              </select>
            </div>
          </div>

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
              onChange={(e) => setSubject(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>

          {isMinibus && (
            <div>
              <Label htmlFor="bd-premises">
                Destination, passengers & driver <span className="text-destructive">*</span>
              </Label>
              <textarea
                id="bd-premises"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[72px] focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="e.g. Harrogate Leisure Centre — 12 students — Mr Smith"
                value={premisesNotes}
                onChange={(e) => setPremisesNotes(e.target.value)}
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !subject.trim()}>
            {submitting ? "Booking…" : "Book room"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
