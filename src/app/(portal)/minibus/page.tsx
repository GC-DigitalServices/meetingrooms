import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import MinibusClient from "./MinibusClient";

export const runtime = "nodejs";

export default async function MinibusPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  const minibuses = await db.room.findMany({
    where: { kind: "MINIBUS", bookable: true },
    orderBy: { displayName: "asc" },
  });

  const now = new Date();
  const until48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const rawBookings =
    minibuses.length > 0
      ? await db.booking.findMany({
          where: {
            roomId: { in: minibuses.map((m: { id: string }) => m.id) },
            startUtc: { lt: until48h },
            endUtc: { gt: now },
          },
        })
      : [];

  const statusBookings = (rawBookings as Array<{ id: string; roomId: string; startUtc: Date; endUtc: Date }>).map((b) => ({
    id: b.id,
    roomId: b.roomId,
    startUtc: b.startUtc.toISOString(),
    endUtc: b.endUtc.toISOString(),
  }));

  return (
    <MinibusClient
      minibuses={minibuses.map((m: { id: string; displayName: string; capacity: number }) => ({
        id: m.id,
        displayName: m.displayName,
        capacity: m.capacity,
      }))}
      statusBookings={statusBookings}
      minibusIds={minibuses.map((m: { id: string }) => m.id)}
    />
  );
}
