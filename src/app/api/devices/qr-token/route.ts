import { NextRequest, NextResponse } from "next/server";
import { requireDeviceAuth, DeviceAuthError, signQrToken } from "@/lib/auth/device";
import { checkRateLimit } from "@/lib/realtime/rateLimit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/devices/qr-token — device-auth'd.
 * Returns a short-lived HMAC QR token (5-min TTL) for embedding in the booking URL.
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

  // Sliding rate limit: 60 mints per device per hour
  const rl = await checkRateLimit(`rl:qr:${device.id}`, 60, 3_600_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "QR token rate limit exceeded. Try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSecs) } },
    );
  }

  const token = signQrToken(device.id, device.roomId, device.scope);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // Log token prefix only — never the full value
  logger.info(
    { deviceId: device.id, tokenPrefix: token.slice(0, 8), remaining: rl.remaining },
    "qr: token minted",
  );

  return NextResponse.json({ token, expiresAt });
}
