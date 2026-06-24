import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { apiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  let session;
  try {
    session = await requireSession(req);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHENTICATED", err.message);
    throw err;
  }

  const bookings = await db.booking.findMany({
    where: { organiserUpn: session.upn },
    orderBy: { startUtc: "asc" },
    include: {
      room: {
        select: {
          id: true,
          displayName: true,
          building: true,
          kind: true,
          parent: { select: { id: true, displayName: true } },
        },
      },
    },
  });

  // For PARKING_BAY bookings, surface the pool's display name and ID
  return NextResponse.json(
    bookings.map((b) => ({
      ...b,
      room:
        b.room.kind === "PARKING_BAY" && b.room.parent
          ? { id: b.room.parent.id, displayName: b.room.parent.displayName, building: null }
          : { id: b.room.id, displayName: b.room.displayName, building: b.room.building },
    }))
  );
}
