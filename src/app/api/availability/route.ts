import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";
import { canSeeRoom } from "@/lib/booking/visibility";
import { db } from "@/lib/db/client";
import { checkRateLimit } from "@/lib/realtime/rateLimit";
import { apiError } from "@/lib/api/errors";

export const runtime = "nodejs";

export interface RoomAvailability {
  free: boolean;
  /** ISO string of the next booking start after the requested window. */
  nextStart?: string;
  /** ISO string of the next booking end after the requested window. */
  nextEnd?: string;
}

/**
 * GET /api/availability?from=<ISO>&to=<ISO>
 * Returns availability for every room the caller can see in the requested window.
 */
export async function GET(req: NextRequest): Promise<Response> {
  let session;
  try {
    session = await requireSession(req);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHENTICATED", err.message);
    throw err;
  }

  const rl = await checkRateLimit(`rl:read:user:${session.upn}`, 100, 60_000);
  if (!rl.allowed) {
    return apiError("RATE_LIMITED", "Too many requests. Please wait a moment.", {
      headers: { "Retry-After": String(rl.retryAfterSecs) },
    });
  }

  const { searchParams } = req.nextUrl;
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  if (!fromParam || !toParam) {
    return apiError("VALIDATION_ERROR", "from and to are required ISO strings");
  }

  const fromDate = new Date(fromParam);
  const toDate = new Date(toParam);
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || fromDate >= toDate) {
    return apiError("VALIDATION_ERROR", "Invalid from/to — must be valid ISO datetimes with from < to");
  }

  const rooms = await db.room.findMany({});
  const visible = rooms.filter((r) =>
    canSeeRoom({ isStaff: session.isStaff, isAdmin: session.isAdmin }, r, true)
  );
  const roomIds = visible.map((r) => r.id);

  const conflicts = await db.booking.findMany({
    where: { roomId: { in: roomIds }, startUtc: { lt: toDate }, endUtc: { gt: fromDate } },
    select: { roomId: true },
  });
  const conflictSet = new Set(conflicts.map((c) => c.roomId));

  const futureBookings = await db.booking.findMany({
    where: { roomId: { in: roomIds }, startUtc: { gte: fromDate } },
    orderBy: { startUtc: "asc" },
    select: { roomId: true, startUtc: true, endUtc: true },
  });
  const nextByRoom = new Map<string, { startUtc: Date; endUtc: Date }>();
  for (const b of futureBookings) {
    if (!nextByRoom.has(b.roomId)) nextByRoom.set(b.roomId, b);
  }

  const result: Record<string, RoomAvailability> = {};
  for (const room of visible) {
    const next = nextByRoom.get(room.id);
    result[room.id] = {
      free: !conflictSet.has(room.id),
      nextStart: next?.startUtc.toISOString(),
      nextEnd: next?.endUtc.toISOString(),
    };
  }

  return NextResponse.json(result);
}
