import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { canUserBookRoom } from "@/lib/booking/permissions";
import { ParkingBookButton } from "@/components/portal/ParkingBookButton";

export const runtime = "nodejs";

function fmtTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(date);
}

function toLocalDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(date);
}

export default async function CarParkPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  // Load all PARKING pools
  const pools = await db.room.findMany({
    where: { kind: "PARKING" },
    include: { sections: { where: { kind: "PARKING_BAY" } } },
    orderBy: { displayName: "asc" },
  });

  if (pools.length === 0) {
    return (
      <div className="px-margin-mobile md:px-margin-desktop pt-lg pb-lg">
        <h1 className="font-extrabold text-headline-xl text-on-background mb-4">Visitor Car Park</h1>
        <p className="text-on-surface-variant">No car park has been set up yet. Ask IT to configure the car park bays.</p>
      </div>
    );
  }

  const now = new Date();
  const todayStr = toLocalDate(now);
  const until = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  // Load bookings for all bays across all pools
  const allBayIds = pools.flatMap((p) => p.sections.map((s) => s.id));
  const rawBookings = await db.booking.findMany({
    where: { roomId: { in: allBayIds }, startUtc: { lt: until }, endUtc: { gt: now } },
    orderBy: { startUtc: "asc" },
    include: { room: { select: { parentRoomId: true } } },
  });

  const nowMs = now.getTime();

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-lg pb-lg">
      <h1 className="font-extrabold text-headline-xl text-on-background mb-lg">Visitor Car Park</h1>

      <div className="space-y-10 max-w-2xl">
        {pools.map((pool) => {
          const bayIds = new Set(pool.sections.map((s) => s.id));
          const poolBookings = rawBookings.filter((b) => bayIds.has(b.roomId));
          const totalBays = pool.sections.length;

          const bookedNow = poolBookings.filter(
            (b) => b.startUtc.getTime() <= nowMs && b.endUtc.getTime() > nowMs
          ).length;
          const freeNow = totalBays - bookedNow;

          let canBook = false;
          try {
            canUserBookRoom(session, pool);
            canBook = true;
          } catch {
            /* not permitted */
          }

          const todayBookings = poolBookings.filter(
            (b) => toLocalDate(b.startUtc) === todayStr
          );

          // Build per-slot availability for today (30-min slots, 07:00–20:00)
          const slots: { time: string; free: number }[] = [];
          for (let m = 7 * 60; m < 20 * 60; m += 30) {
            const slotStart = new Date(now);
            slotStart.setHours(0, 0, 0, 0);
            slotStart.setMinutes(slotStart.getMinutes() + m);
            const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);
            const booked = poolBookings.filter(
              (b) => b.startUtc < slotEnd && b.endUtc > slotStart
            ).length;
            slots.push({ time: fmtTime(slotStart), free: totalBays - booked });
          }

          return (
            <section key={pool.id}>
              {/* Pool header */}
              <div className="flex flex-wrap items-center justify-between gap-4 mb-md">
                <div>
                  <h2 className="text-xl font-bold text-on-background">{pool.displayName}</h2>
                  <div className="flex items-center gap-3 mt-1 text-sm text-on-surface-variant">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">local_parking</span>
                      {totalBays} bays total
                    </span>
                    <span className={`font-semibold ${freeNow > 0 ? "text-green-700" : "text-red-600"}`}>
                      {freeNow} available right now
                    </span>
                  </div>
                </div>

                {canBook && (
                  <ParkingBookButton roomId={pool.id} roomName={pool.displayName} />
                )}
              </div>

              {/* Today's slot grid */}
              <div className="bg-white rounded-xl border border-outline-variant/20 shadow-card overflow-hidden">
                <div className="px-4 py-3 border-b border-outline-variant/20 bg-surface-container-low">
                  <h3 className="text-sm font-semibold text-on-surface">Today&apos;s availability</h3>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                    {slots.map(({ time, free }) => {
                      const isPast = (() => {
                        const [h, m] = time.split(":").map(Number);
                        const slotMs = new Date().setHours(h, m + 30, 0, 0);
                        return slotMs < nowMs;
                      })();
                      return (
                        <div
                          key={time}
                          className={`rounded p-2 text-center text-xs ${
                            isPast
                              ? "bg-surface-container text-on-surface-variant/50"
                              : free === 0
                              ? "bg-red-50 text-red-700"
                              : free <= 2
                              ? "bg-amber-50 text-amber-700"
                              : "bg-green-50 text-green-700"
                          }`}
                        >
                          <div className="font-semibold">{time}</div>
                          <div className={isPast ? "" : "font-bold"}>{isPast ? "—" : `${free}/${totalBays}`}</div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-on-surface-variant mt-3">
                    Green = bays free · Amber = limited · Red = full
                  </p>
                </div>
              </div>

              {/* Upcoming bookings list */}
              {todayBookings.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                    Today&apos;s bookings
                  </h3>
                  <div className="space-y-1">
                    {todayBookings.map((b) => (
                      <div key={b.id} className="flex items-center gap-3 text-sm border rounded px-3 py-2 bg-white">
                        <span className="material-symbols-outlined text-sm text-on-surface-variant">schedule</span>
                        <span className="text-on-surface-variant whitespace-nowrap">
                          {fmtTime(b.startUtc)} – {fmtTime(b.endUtc)}
                        </span>
                        <span className="text-on-surface">{b.subject || "Visitor Car Park"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
