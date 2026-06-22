import { NextRequest, NextResponse } from "next/server";
import { getRedisClient } from "@/lib/realtime/redis";
import { checkRateLimit } from "@/lib/realtime/rateLimit";
import { db } from "@/lib/db/client";
import { apiError } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import { z } from "zod";
import crypto from "crypto";

export const runtime = "nodejs";

const EnrollSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Pairing code must be 6 digits"),
});

/**
 * POST /api/devices/enroll — no auth required.
 * iPad presents a 6-digit pairing code and receives a long-lived device token (once only).
 *
 * The code space is small (10^6) and a successful guess yields a long-lived
 * device token, so this endpoint is brute-force throttled per-IP AND globally,
 * and the limit fails CLOSED so a Redis outage can't remove the throttle.
 */
export async function POST(req: NextRequest): Promise<Response> {
  // Brute-force protection — fail closed.
  const ip =
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const ipRl = await checkRateLimit(`rl:enroll:ip:${ip}`, 5, 60_000, { failClosed: true });
  const globalRl = await checkRateLimit("rl:enroll:global", 60, 60_000, { failClosed: true });
  if (!ipRl.allowed || !globalRl.allowed) {
    logger.warn({ ip }, "enroll: rate limited");
    return apiError("RATE_LIMITED", "Too many enrolment attempts. Please wait and try again.", {
      headers: { "Retry-After": String(Math.max(ipRl.retryAfterSecs, globalRl.retryAfterSecs)) },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid request body");
  }

  const parsed = EnrollSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "Invalid pairing code format");
  }

  const { code } = parsed.data;
  const redis = getRedisClient();
  const raw = await redis.get(`device:pair:${code}`);

  if (!raw) {
    return apiError("VALIDATION_ERROR", "Invalid or expired pairing code");
  }

  const { roomId, scope, name } = JSON.parse(raw) as {
    roomId: string;
    scope: "STANDARD" | "SECTION" | "COMPOSITE";
    name: string | null;
  };

  // Single-use: delete before responding so a retry with the same code fails
  await redis.del(`device:pair:${code}`);

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const device = await db.device.create({
    data: { roomId, scope, name, tokenHash },
  });

  return NextResponse.json({ token, deviceId: device.id }, { status: 201 });
}
