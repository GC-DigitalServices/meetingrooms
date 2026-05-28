import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";
import { canSeeRoom } from "@/lib/booking/visibility";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  let session;
  try {
    session = await requireSession(req);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const showAll = req.nextUrl.searchParams.get("showAll") === "true";

  const rooms = await db.room.findMany({
    orderBy: [{ building: "asc" }, { displayName: "asc" }],
  });

  const visible = rooms.filter((r) =>
    canSeeRoom({ isStaff: session.isStaff, isAdmin: session.isAdmin }, r, showAll)
  );

  return NextResponse.json(visible);
}
