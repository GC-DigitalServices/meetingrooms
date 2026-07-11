import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { canUserBookRoom } from "@/lib/booking/permissions";
import { CarparkDateNav } from "@/components/portal/CarparkDateNav";
import CarparkPoolLive from "@/components/portal/CarparkPoolLive";
import { localDateISO, londonDayStartUtc } from "@/lib/utils";

export const runtime = "nodejs";

export default async function CarParkPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  const { date: dateParam } = await searchParams;

  const now = new Date();
  const todayStr = localDateISO(now);
  const maxDateStr = localDateISO(new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000));

  // Validate date param: must be YYYY-MM-DD and within [today, today+90]
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

  // Load all PARKING pools
  const pools = await db.room.findMany({
    where: { kind: "PARKING" },
    include: { sections: { where: { kind: "PARKING_BAY" } } },
    orderBy: { displayName: "asc" },
  });

  if (pools.length === 0) {
    return (
      <div className="px-margin-mobile md:px-margin-desktop pt-lg pb-lg">
        <h1 className="font-extrabold text-headline-xl text-on-background mb-4">
          Visitor Car Park
        </h1>
        <p className="text-on-surface-variant">No car park has been set up yet.</p>
      </div>
    );
  }

  // Load bookings for all bays that overlap the selected day
  const allBayIds = pools.flatMap((p) => p.sections.map((s) => s.id));
  const rawBookings = await db.booking.findMany({
    where: { roomId: { in: allBayIds }, startUtc: { lt: dayEnd }, endUtc: { gt: dayStart } },
    orderBy: { startUtc: "asc" },
  });

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-lg pb-lg">
      <h1 className="font-extrabold text-headline-xl text-on-background mb-lg">Visitor Car Park</h1>

      <CarparkDateNav
        selectedDate={selectedDate}
        today={todayStr}
        maxDate={maxDateStr}
        basePath="/carpark"
      />

      <div className="space-y-10 max-w-2xl">
        {pools.map((pool) => {
          const bayIds = pool.sections.map((s) => s.id);
          const bayIdSet = new Set(bayIds);

          let canBook = false;
          try {
            canUserBookRoom(session, pool);
            canBook = true;
          } catch {
            /* not permitted */
          }

          return (
            <CarparkPoolLive
              key={pool.id}
              pool={{ id: pool.id, displayName: pool.displayName }}
              bayIds={bayIds}
              isToday={isToday}
              canBook={canBook}
              dayStartMs={dayStart.getTime()}
              initialBookings={rawBookings
                .filter((b) => bayIdSet.has(b.roomId))
                .map((b) => ({
                  id: b.id,
                  roomId: b.roomId,
                  startUtc: b.startUtc.toISOString(),
                  endUtc: b.endUtc.toISOString(),
                  subject: b.subject,
                  organiserName: b.organiserName,
                }))}
            />
          );
        })}
      </div>
    </div>
  );
}
