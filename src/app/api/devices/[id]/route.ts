import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { disconnectDevice } from "@/lib/realtime/socket";

export const runtime = "nodejs";

/**
 * DELETE /api/devices/[id] — admin revokes a device.
 * Deletes the token hash from the DB and disconnects any active socket.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let session;
  try {
    session = await requireSession(req);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
  if (!session.isAdmin) return NextResponse.json({ error: "Admin required" }, { status: 403 });

  const { id } = await params;

  const device = await db.device.findUnique({ where: { id } });
  if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404 });

  await db.device.delete({ where: { id } });

  // Best-effort socket disconnect — no-op if socket server isn't running
  try {
    disconnectDevice(id);
  } catch {
    // socket server may not be initialised in test/build environments
  }

  return new NextResponse(null, { status: 204 });
}
