import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { getConfig } from "@/lib/config";
import crypto from "crypto";
import type { Device, Room } from "@prisma/client";

export class DeviceAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceAuthError";
  }
}

export type DeviceWithRoom = Device & {
  room: Room & { sections: Room[] };
};

/**
 * Reads Authorization: Bearer <token>, looks up device by SHA-256 hash.
 * Throws DeviceAuthError (→ 401) if missing or unrecognised.
 */
export async function requireDeviceAuth(req: NextRequest): Promise<DeviceWithRoom> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) throw new DeviceAuthError("Missing device token");
  const token = auth.slice(7).trim();
  if (!token) throw new DeviceAuthError("Missing device token");

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const device = await db.device.findUnique({
    where: { tokenHash },
    include: { room: { include: { sections: true } } },
  });
  if (!device) throw new DeviceAuthError("Unknown or revoked device token");
  return device as DeviceWithRoom;
}

// ---------------------------------------------------------------------------
// QR token — HMAC-SHA256 over a base64url-encoded JSON payload
// Format: <base64url-payload>.<base64url-hmac>
// TTL: 5 minutes (300 s)
// ---------------------------------------------------------------------------

export interface QrPayload {
  deviceId: string;
  roomId: string;
  scope: string;
  iat: number;
  exp: number;
}

export function signQrToken(deviceId: string, roomId: string, scope: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: QrPayload = { deviceId, roomId, scope, iat: now, exp: now + 300 };
  const { QR_SIGNING_KEY } = getConfig();
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", QR_SIGNING_KEY).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyQrToken(token: string): QrPayload | null {
  try {
    const dot = token.indexOf(".");
    if (dot === -1) return null;
    const data = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    if (!data || !sig) return null;

    const { QR_SIGNING_KEY } = getConfig();
    const expected = crypto
      .createHmac("sha256", QR_SIGNING_KEY)
      .update(data)
      .digest("base64url");

    // timingSafeEqual requires equal-length buffers; HMAC-SHA256 always produces
    // fixed-length base64url so lengths must match — return null if they don't.
    const aBuf = Buffer.from(sig);
    const bBuf = Buffer.from(expected);
    if (aBuf.length !== bBuf.length) return null;
    if (!crypto.timingSafeEqual(aBuf, bBuf)) return null;

    const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as QrPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}
