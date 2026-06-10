import { NextRequest, NextResponse } from "next/server";
import { requireDeviceAuth, DeviceAuthError, signQrToken } from "@/lib/auth/device";
import { checkRateLimit } from "@/lib/realtime/rateLimit";
import { apiError } from "@/lib/api/errors";
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
    if (err instanceof DeviceAuthError) return apiError("UNAUTHENTICATED", err.message);
    throw err;
  }

  const rl = await checkRateLimit(`rl:qr:${device.id}`, 60, 3_600_000, { failClosed: true });
  if (!rl.allowed) {
    return apiError("RATE_LIMITED", "QR token rate limit exceeded. Try again later.", {
      headers: { "Retry-After": String(rl.retryAfterSecs) },
    });
  }

  const token = signQrToken(device.id, device.roomId, device.scope);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  logger.info(
    { deviceId: device.id, tokenPrefix: token.slice(0, 8), remaining: rl.remaining },
    "qr: token minted",
  );

  return NextResponse.json({ token, expiresAt });
}
