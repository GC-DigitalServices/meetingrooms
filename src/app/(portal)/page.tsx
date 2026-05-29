import { getServerSession } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { canSeeRoom } from "@/lib/booking/visibility";
import { canUserBookRoom } from "@/lib/booking/permissions";
import RoomGrid from "@/components/portal/RoomGrid";
import type { BookingSlot } from "@/hooks/useRoomLive";

export const runtime = "nodejs";

export default async function PortalPage() {
  const session = (await getServerSession())!;

  const now = new Date();
  const until = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const allRooms = await db.room.findMany({
    orderBy: [{ building: "asc" }, { displayName: "asc" }],
  });

  // What the user can see (showAll=true so non-staff still get all rooms when they toggle)
  const visibleRooms = allRooms.filter((r) =>
    canSeeRoom({ isStaff: session.isStaff, isAdmin: session.isAdmin }, r, true)
  );

  // Which rooms the user can actually book
  const permittedRoomIds = visibleRooms
    .filter((r) => {
      try {
        canUserBookRoom(session, r);
        return true;
      } catch {
        return false;
      }
    })
    .map((r) => r.id);

  const rawBookings = await db.booking.findMany({
    where: {
      roomId: { in: visibleRooms.map((r) => r.id) },
      startUtc: { lt: until },
      endUtc: { gt: now },
    },
  });

  // For the initial grid render we only need free/busy (no detail stripping needed —
  // status computation only uses start/end times, not subject/organiser).
  const initialBookings: BookingSlot[] = rawBookings.map((b) => ({
    id: b.id,
    roomId: b.roomId,
    startUtc: b.startUtc.toISOString(),
    endUtc: b.endUtc.toISOString(),
    isAllDay: b.isAllDay,
    visibility: "busy",
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Rooms</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {session.isStaff || session.isAdmin
            ? "Find and book an available room"
            : "Find and book a room you're permitted to use"}
        </p>
      </div>

      <RoomGrid
        rooms={visibleRooms.map((r) => ({
          id: r.id,
          displayName: r.displayName,
          building: r.building,
          floor: r.floor,
          capacity: r.capacity,
          equipment: r.equipment,
          kind: r.kind,
          bookable: r.bookable,
        }))}
        initialBookings={initialBookings}
        isStaff={session.isStaff}
        isAdmin={session.isAdmin}
        permittedRoomIds={permittedRoomIds}
      />
    </div>
  );
}
