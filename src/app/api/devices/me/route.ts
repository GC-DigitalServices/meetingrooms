import { NextRequest, NextResponse } from "next/server";
import { requireDeviceAuth, DeviceAuthError } from "@/lib/auth/device";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

/**
 * GET /api/devices/me — device-auth'd.
 * Returns device + room metadata. Used by the display on first load.
 * Also updates lastSeenAt.
 */
export async function GET(req: NextRequest): Promise<Response> {
  let device;
  try {
    device = await requireDeviceAuth(req);
  } catch (err) {
    if (err instanceof DeviceAuthError)
      return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  // Fire-and-forget lastSeenAt update
  db.device
    .update({ where: { id: device.id }, data: { lastSeenAt: new Date() } })
    .catch(() => {});

  return NextResponse.json({
    device: {
      id: device.id,
      scope: device.scope,
      name: device.name,
    },
    room: {
      id: device.room.id,
      displayName: device.room.displayName,
      capacity: device.room.capacity,
      kind: device.room.kind,
      sections: device.room.sections.map((s) => ({
        id: s.id,
        displayName: s.displayName,
        capacity: s.capacity,
      })),
    },
  });
}
