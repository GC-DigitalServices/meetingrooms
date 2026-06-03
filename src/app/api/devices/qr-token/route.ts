import { NextRequest, NextResponse } from "next/server";
import { requireDeviceAuth, DeviceAuthError, signQrToken } from "@/lib/auth/device";
import { getRedisClient } from "@/lib/realtime/redis";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const RATE_LIMIT = 60; // mints per device per hour

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
  const redis = getRedisClient();
  const key = `qr:rate:${device.id}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 3600);

  if (count > RATE_LIMIT) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }

  const token = signQrToken(device.id, device.roomId, device.scope);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // Log token prefix only — never the full value
  logger.info(
    { deviceId: device.id, tokenPrefix: token.slice(0, 8), count },
    "qr: token minted",
  );

  return NextResponse.json({ token, expiresAt });
}
