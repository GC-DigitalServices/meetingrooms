import { notFound, redirect } from "next/navigation";
import { Users, MapPin } from "lucide-react";
import { getServerSession } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { canSeeRoom, bookingDetailVisibility } from "@/lib/booking/visibility";
import { canUserBookRoom } from "@/lib/booking/permissions";
import DayTimeline from "@/components/portal/DayTimeline";
import { Badge } from "@/components/ui/badge";
import { localTime, localDateISO } from "@/lib/utils";
import type { BookingSlot } from "@/hooks/useRoomLive";

export const runtime = "nodejs";

export default async function RoomDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  const room = await db.room.findUnique({
    where: { id },
    include: { sections: true },
  });
  if (!room) notFound();
  if (!canSeeRoom({ isStaff: session.isStaff, isAdmin: session.isAdmin }, room, true)) notFound();

  let canBook = false;
  try {
    canUserBookRoom(session, room);
    canBook = true;
  } catch {
    /* not permitted */
  }

  // 7-day window starting from start of today
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const until7d = new Date(todayStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  // For PARKING pools, load bookings across all bay IDs
  const bookingRoomIds = room.kind === "PARKING" ? room.sections.map((s) => s.id) : [id];
  const totalBays = room.kind === "PARKING" ? room.sections.length : 0;

  const rawBookings = await db.booking.findMany({
    where: {
      roomId: { in: bookingRoomIds },
      startUtc: { lt: until7d },
      endUtc: { gt: todayStart },
    },
    orderBy: { startUtc: "asc" },
  });

  // Visibility-strip bookings
  const organiserUpns = [...new Set(rawBookings.map((b) => b.organiserUpn))];
  const users = await db.user.findMany({
    where: { upn: { in: organiserUpns } },
    select: { upn: true, isStaff: true },
  });
  const staffMap = new Map(users.map((u) => [u.upn, u.isStaff]));

  const initialBookings: BookingSlot[] = rawBookings.map((b) => {
    const organiserIsStaff = staffMap.get(b.organiserUpn) ?? false;
    const vis = bookingDetailVisibility(session, {
      organiserUpn: b.organiserUpn,
      organiserIsStaff,
    });
    if (vis === "busy") {
      return {
        id: b.id,
        roomId: b.roomId,
        startUtc: b.startUtc.toISOString(),
        endUtc: b.endUtc.toISOString(),
        isAllDay: b.isAllDay,
        visibility: "busy",
      };
    }
    return {
      id: b.id,
      roomId: b.roomId,
      startUtc: b.startUtc.toISOString(),
      endUtc: b.endUtc.toISOString(),
      isAllDay: b.isAllDay,
      visibility: "full",
      subject: b.subject,
      organiserUpn: b.organiserUpn,
      organiserName: b.organiserName,
      source: b.source,
    };
  });

  if (room.kind === "PARKING") {
    const nowMs = now.getTime();
    const bookedNow = rawBookings.filter(
      (b) => new Date(b.startUtc).getTime() <= nowMs && new Date(b.endUtc).getTime() > nowMs,
    ).length;
    const freeNow = totalBays - bookedNow;
    const todayStr = localDateISO(now);
    const todayBookings = rawBookings.filter((b) => localDateISO(b.startUtc) === todayStr);

    return (
      <div className="px-margin-mobile md:px-margin-desktop pt-lg pb-lg">
        <div className="max-w-2xl">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">{room.displayName}</h1>
            <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">local_parking</span>
                {totalBays} bays
              </span>
              <span className={`font-medium ${freeNow > 0 ? "text-green-700" : "text-red-600"}`}>
                {freeNow} available now
              </span>
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
              Today&apos;s bookings
            </h2>
            {todayBookings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No bookings today — all {totalBays} bays free.
              </p>
            ) : (
              <div className="space-y-2">
                {todayBookings.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center gap-4 text-sm border rounded px-3 py-2"
                  >
                    <span className="text-muted-foreground whitespace-nowrap">
                      {localTime(b.startUtc)} – {localTime(b.endUtc)}
                    </span>
                    <span>Visitor Car Park</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-lg pb-lg">
      <div className="max-w-2xl">
        {/* Room header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">{room.displayName}</h1>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
            {(room.building || room.floor) && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {[room.building, room.floor].filter(Boolean).join(", ")}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              Up to {room.capacity} people
            </span>
            {room.equipment.map((e) => (
              <Badge key={e} variant="secondary" className="capitalize">
                {e}
              </Badge>
            ))}
            {!canBook && (
              <Badge variant="outline" className="text-muted-foreground">
                View only
              </Badge>
            )}
          </div>
        </div>

        <DayTimeline
          room={{ id: room.id, displayName: room.displayName, kind: room.kind }}
          initialBookings={initialBookings}
          canBook={canBook}
          viewerUpn={session.upn}
          isAdmin={session.isAdmin}
        />
      </div>
    </div>
  );
}
