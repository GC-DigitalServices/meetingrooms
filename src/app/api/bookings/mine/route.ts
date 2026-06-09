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
    include: { room: { select: { id: true, displayName: true, building: true, kind: true } } },
  });

  return NextResponse.json(bookings);
}
