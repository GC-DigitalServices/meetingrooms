import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";
import { bookingDetailVisibility } from "@/lib/booking/visibility";
import { db } from "@/lib/db/client";
import { z } from "zod";

export const runtime = "nodejs";

const QuerySchema = z.object({
  from: z.string().datetime(),
  to:   z.string().datetime(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  let session;
  try {
    session = await requireSession(req);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const { id: roomId } = await params;
  const { searchParams } = req.nextUrl;

  const parsed = QuerySchema.safeParse({
    from: searchParams.get("from"),
    to:   searchParams.get("to"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "from and to are required ISO datetime strings" },
      { status: 400 }
    );
  }

  const { from, to } = parsed.data;

  const bookings = await db.booking.findMany({
    where: {
      roomId,
      startUtc: { lt: new Date(to) },
      endUtc:   { gt: new Date(from) },
    },
    orderBy: { startUtc: "asc" },
    include: {
      room: { select: { id: true } },
    },
  });

  // Enrich with organiser isStaff from User table, apply visibility stripping
  const organiserUpns = [...new Set(bookings.map((b) => b.organiserUpn))];
  const users = await db.user.findMany({
    where: { upn: { in: organiserUpns } },
    select: { upn: true, isStaff: true },
  });
  const staffMap = new Map(users.map((u) => [u.upn, u.isStaff]));

  const stripped = bookings.map((booking) => {
    const organiserIsStaff = staffMap.get(booking.organiserUpn) ?? false;
    const visibility = bookingDetailVisibility(session, {
      organiserUpn:   booking.organiserUpn,
      organiserIsStaff,
    });

    if (visibility === "busy") {
      return {
        id:       booking.id,
        roomId:   booking.roomId,
        startUtc: booking.startUtc,
        endUtc:   booking.endUtc,
        isAllDay: booking.isAllDay,
        busy:     true,
      };
    }
    return booking;
  });

  return NextResponse.json(stripped);
}
