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

  // Map each parent to its children (composite → sections, pool → bays).
  const childrenByParent = new Map<string, typeof rooms>();
  for (const r of rooms) {
    if (!r.parentRoomId) continue;
    const arr = childrenByParent.get(r.parentRoomId) ?? [];
    arr.push(r);
    childrenByParent.set(r.parentRoomId, arr);
  }

  // The room ids whose bookings block a booking on this room — mirrors the
  // booking write path's family logic, so the grid agrees with what booking
  // will actually accept. (PARKING is handled separately below: a pool is free
  // while any one bay is free, rather than blocked by any bay being busy.)
  function familyIds(room: (typeof rooms)[number]): string[] {
    if (room.kind === "COMPOSITE") {
      return [room.id, ...(childrenByParent.get(room.id)?.map((c) => c.id) ?? [])];
    }
    if (room.kind === "SECTION" && room.parentRoomId) {
      // whole-room (parent) booking + all sibling sections (incl. self)
      return [
        room.parentRoomId,
        ...(childrenByParent.get(room.parentRoomId)?.map((c) => c.id) ?? []),
      ];
    }
    return [room.id];
  }

  // Ids to watch for a room's availability: its family, or a pool's bays.
  function watchIds(room: (typeof rooms)[number]): string[] {
    if (room.kind === "PARKING") return (childrenByParent.get(room.id) ?? []).map((b) => b.id);
    return familyIds(room);
  }

  // One query over the union of watched ids (may include rooms the caller can't
  // see — their bookings still affect availability).
  const relevantIds = [...new Set(visible.flatMap((r) => watchIds(r)))];

  const conflicts = await db.booking.findMany({
    where: { roomId: { in: relevantIds }, startUtc: { lt: toDate }, endUtc: { gt: fromDate } },
    select: { roomId: true },
  });
  const conflictSet = new Set(conflicts.map((c) => c.roomId));

  const futureBookings = await db.booking.findMany({
    where: { roomId: { in: relevantIds }, startUtc: { gte: fromDate } },
    orderBy: { startUtc: "asc" },
    select: { roomId: true, startUtc: true, endUtc: true },
  });

  const result: Record<string, RoomAvailability> = {};
  for (const room of visible) {
    let free: boolean;
    if (room.kind === "PARKING") {
      const bays = childrenByParent.get(room.id) ?? [];
      free = bays.some((b) => b.mailboxUpn && !conflictSet.has(b.id));
    } else {
      free = !familyIds(room).some((id) => conflictSet.has(id));
    }

    const watch = new Set(watchIds(room));
    const next = futureBookings.find((b) => watch.has(b.roomId));
    result[room.id] = {
      free,
      nextStart: next?.startUtc.toISOString(),
      nextEnd: next?.endUtc.toISOString(),
    };
  }

  return NextResponse.json(result);
}
