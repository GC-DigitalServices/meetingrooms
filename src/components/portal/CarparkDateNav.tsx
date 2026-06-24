"use client";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  selectedDate: string; // YYYY-MM-DD
  today: string;        // YYYY-MM-DD
  maxDate: string;      // YYYY-MM-DD
}

function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + delta);
  return date.toLocaleDateString("en-CA");
}

export function CarparkDateNav({ selectedDate, today, maxDate }: Props) {
  const router = useRouter();

  function go(dateStr: string) {
    if (dateStr === today) {
      router.push("/carpark");
    } else {
      router.push(`/carpark?date=${dateStr}`);
    }
  }

  const prevDate = addDays(selectedDate, -1);
  const nextDate = addDays(selectedDate, 1);
  const isToday = selectedDate === today;

  const label = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(selectedDate + "T12:00:00Z"));

  return (
    <div className="flex items-center gap-3 mb-lg flex-wrap">
      <button
        onClick={() => go(prevDate)}
        disabled={selectedDate <= today}
        className="p-2 rounded-lg border border-outline-variant hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        aria-label="Previous day"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-base font-semibold text-on-background">
          {isToday ? `Today — ${label}` : label}
        </span>
        <input
          type="date"
          value={selectedDate}
          min={today}
          max={maxDate}
          onChange={(e) => { if (e.target.value) go(e.target.value); }}
          className="text-sm border border-outline-variant rounded px-2 py-1 bg-surface text-on-surface"
        />
      </div>

      <button
        onClick={() => go(nextDate)}
        disabled={selectedDate >= maxDate}
        className="p-2 rounded-lg border border-outline-variant hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        aria-label="Next day"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
