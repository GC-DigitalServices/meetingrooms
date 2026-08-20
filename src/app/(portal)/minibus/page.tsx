import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import MinibusClient from "./MinibusClient";
import { CarparkDateNav } from "@/components/portal/CarparkDateNav";
import { localDateISO, londonDayStartUtc } from "@/lib/utils";
import { maxBookableDate } from "@/lib/booking/horizon";

export const runtime = "nodejs";

export default async function MinibusPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  const { date: dateParam } = await searchParams;

  const now = new Date();
  const todayStr = localDateISO(now);
  const maxDateStr = maxBookableDate(session.isAdmin, "MINIBUS", now);

  let selectedDate = todayStr;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    if (dateParam >= todayStr && dateParam <= maxDateStr) {
      selectedDate = dateParam;
    }
  }

  const isToday = selectedDate === todayStr;

  // London midnight, not UTC midnight — during BST they differ by an hour
  const dayStart = londonDayStartUtc(selectedDate);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
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
    (b: {
      id: string;
      roomId: string;
      startUtc: Date;
      endUtc: Date;
      subject: string | null;
      organiserName: string | null;
    }) => ({
      id: b.id,
      roomId: b.roomId,
      startUtc: b.startUtc.toISOString(),
      endUtc: b.endUtc.toISOString(),
      subject: b.subject,
      organiserName: b.organiserName,
    }),
  );

  // statusBookings: used by the client for "busy now" / "available until" (today only)
  const statusBookings = isToday ? allBookings : [];

  // dayBookings: the selected day's schedule (for all dates)
  const dayBookings = isToday
    ? allBookings.filter((b) => localDateISO(b.startUtc) === selectedDate)
    : allBookings;

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-lg pb-lg">
      <CarparkDateNav
        selectedDate={selectedDate}
        today={todayStr}
        maxDate={maxDateStr}
        basePath="/minibus"
      />
      <MinibusClient
        minibuses={minibuses.map((m: { id: string; displayName: string; capacity: number }) => ({
          id: m.id,
          displayName: m.displayName,
          capacity: m.capacity,
        }))}
        statusBookings={statusBookings}
        dayBookings={dayBookings}
        minibusIds={minibusIds}
        isAdmin={session.isAdmin}
        isToday={isToday}
      />
    </div>
  );
}
