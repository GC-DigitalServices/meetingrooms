import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import MinibusClient from "./MinibusClient";
import { CarparkDateNav } from "@/components/portal/CarparkDateNav";

export const runtime = "nodejs";

function toLocalDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(date);
}

export default async function MinibusPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  const { date: dateParam } = await searchParams;

  const now = new Date();
  const todayStr = toLocalDate(now);
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const maxDate = new Date(Date.UTC(ty, tm - 1, td + 90));
  const maxDateStr = toLocalDate(maxDate);

  let selectedDate = todayStr;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    if (dateParam >= todayStr && dateParam <= maxDateStr) {
      selectedDate = dateParam;
    }
  }

  const isToday = selectedDate === todayStr;

  const dayStart = new Date(selectedDate + "T00:00:00.000Z");
  const dayEnd = new Date(selectedDate + "T24:00:00.000Z");
  // For today: extend the window to 48h so "available until tomorrow" edge case works
  const queryEnd = isToday ? new Date(now.getTime() + 48 * 60 * 60 * 1000) : dayEnd;
  const queryStart = isToday ? now : dayStart;

  const minibuses = await db.room.findMany({
    where: { kind: "MINIBUS", bookable: true },
    orderBy: { displayName: "asc" },
  });

  const minibusIds = minibuses.map((m: { id: string }) => m.id);

  const rawBookings =
    minibuses.length > 0
      ? await db.booking.findMany({
          where: {
            roomId: { in: minibusIds },
            startUtc: { lt: queryEnd },
            endUtc: { gt: queryStart },
          },
          select: {
            id: true,
            roomId: true,
            startUtc: true,
            endUtc: true,
            subject: true,
            organiserName: true,
          },
          orderBy: { startUtc: "asc" },
        })
      : [];

  type SerializedBooking = {
    id: string;
    roomId: string;
    startUtc: string;
    endUtc: string;
    subject: string | null;
    organiserName: string | null;
  };

  const allBookings: SerializedBooking[] = rawBookings.map(
    (b: { id: string; roomId: string; startUtc: Date; endUtc: Date; subject: string | null; organiserName: string | null }) => ({
      id: b.id,
      roomId: b.roomId,
      startUtc: b.startUtc.toISOString(),
      endUtc: b.endUtc.toISOString(),
      subject: b.subject,
      organiserName: b.organiserName,
    })
  );

  // statusBookings: used by the client for "busy now" / "available until" (today only)
  const statusBookings = isToday ? allBookings : [];

  // dayBookings: the selected day's schedule (for all dates)
  const dayBookings = isToday
    ? allBookings.filter((b) => {
        const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(b.startUtc));
        return d === selectedDate;
      })
    : allBookings;

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-lg pb-lg">
      <CarparkDateNav selectedDate={selectedDate} today={todayStr} maxDate={maxDateStr} basePath="/minibus" />
      <MinibusClient
        minibuses={minibuses.map((m: { id: string; displayName: string; capacity: number }) => ({
          id: m.id,
          displayName: m.displayName,
          capacity: m.capacity,
        }))}
        statusBookings={statusBookings}
        dayBookings={dayBookings}
        minibusIds={minibusIds}
        isToday={isToday}
      />
    </div>
  );
}
