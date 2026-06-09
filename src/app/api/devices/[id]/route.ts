import { NextRequest } from "next/server";
import { requireSession, AuthError } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { disconnectDevice } from "@/lib/realtime/socket";
import { apiError } from "@/lib/api/errors";

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
    if (err instanceof AuthError) return apiError("UNAUTHENTICATED", err.message);
    throw err;
  }
  if (!session.isAdmin) return apiError("FORBIDDEN", "Admin required");

  const { id } = await params;

  const device = await db.device.findUnique({ where: { id } });
  if (!device) return apiError("NOT_FOUND", "Device not found");

  await db.device.delete({ where: { id } });

  try {
    disconnectDevice(id);
  } catch {
    // socket server may not be initialised in test/build environments
  }

  return new Response(null, { status: 204 });
}
