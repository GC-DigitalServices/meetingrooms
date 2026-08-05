import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError, ForbiddenError } from "@/lib/auth";
import { apiError } from "@/lib/api/errors";
import { db } from "@/lib/db/client";
import type { Prisma, RoomKind } from "@prisma/client";
import { z } from "zod";

export const runtime = "nodejs";

const MAX_RESULTS = 100;

// Rooms, minibuses and parking bays are all Rooms sharing one Booking table,
// so admin search is a single query filtered by room kind. These groups are
// the three things an admin actually thinks in terms of.
const KIND_GROUPS: Record<string, RoomKind[]> = {
  ROOMS: ["STANDARD", "COMPOSITE", "SECTION"],
  MINIBUS: ["MINIBUS"],
  PARKING: ["PARKING", "PARKING_BAY"],
};

const QuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  kind: z.enum(["ALL", "ROOMS", "MINIBUS", "PARKING"]).catch("ALL"),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  try {
    await requireAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHENTICATED", err.message);
    if (err instanceof ForbiddenError) return apiError("FORBIDDEN", err.message);
    throw err;
  }

  const sp = req.nextUrl.searchParams;
  const parsed = QuerySchema.safeParse({
    q: sp.get("q") ?? undefined,
    kind: sp.get("kind") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  });
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "Invalid search parameters", {
      details: parsed.error.flatten(),
    });
  }

  const { q, kind, from, to } = parsed.data;

  const where: Prisma.BookingWhereInput = {};

  if (kind !== "ALL") {
    where.room = { kind: { in: KIND_GROUPS[kind] } };
  }

  // A booking is in range if it overlaps [from, to] — not merely starts in it,
  // so a long minibus trip still shows up when searching a day it covers.
  if (from) where.endUtc = { gte: new Date(from) };
  if (to) where.startUtc = { lte: new Date(to) };

  if (q) {
    where.OR = [
      { subject: { contains: q, mode: "insensitive" } },
      { organiserName: { contains: q, mode: "insensitive" } },
      { organiserUpn: { contains: q, mode: "insensitive" } },
      { room: { displayName: { contains: q, mode: "insensitive" } } },
    ];
  }

  const bookings = await db.booking.findMany({
    where,
    orderBy: { startUtc: "asc" },
    take: MAX_RESULTS + 1,
    include: {
      room: { select: { id: true, displayName: true, kind: true, building: true } },
    },
  });

  const truncated = bookings.length > MAX_RESULTS;

  return NextResponse.json({
    truncated,
    bookings: bookings.slice(0, MAX_RESULTS).map((b) => ({
      id: b.id,
      subject: b.subject,
      organiserName: b.organiserName,
      organiserUpn: b.organiserUpn,
      startUtc: b.startUtc.toISOString(),
      endUtc: b.endUtc.toISOString(),
      isAllDay: b.isAllDay,
      premisesNotes: b.premisesNotes,
      // Surfaced so the UI can flag that deleting removes this occurrence only.
      isRecurring: b.recurringGroupId !== null,
      room: b.room,
    })),
  });
}
