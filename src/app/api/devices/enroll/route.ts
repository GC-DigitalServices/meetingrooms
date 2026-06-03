import { NextRequest, NextResponse } from "next/server";
import { getRedisClient } from "@/lib/realtime/redis";
import { db } from "@/lib/db/client";
import { z } from "zod";
import crypto from "crypto";

export const runtime = "nodejs";

const EnrollSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Pairing code must be 6 digits"),
});

/**
 * POST /api/devices/enroll — no auth required.
 * iPad presents a 6-digit pairing code and receives a long-lived device token (once only).
 */
export async function POST(req: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = EnrollSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid pairing code format" }, { status: 400 });
  }

  const { code } = parsed.data;
  const redis = getRedisClient();
  const raw = await redis.get(`device:pair:${code}`);

  if (!raw) {
    return NextResponse.json({ error: "Invalid or expired pairing code" }, { status: 400 });
  }

  const { roomId, scope, name } = JSON.parse(raw) as {
    roomId: string;
    scope: "STANDARD" | "SECTION" | "COMPOSITE";
    name: string | null;
  };

  // Single-use: delete before responding so a retry with the same code fails
  await redis.del(`device:pair:${code}`);

  // 256-bit random token; stored as SHA-256 hash (SHA-256 is fine for high-entropy random inputs)
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const device = await db.device.create({
    data: { roomId, scope, name, tokenHash },
  });

  return NextResponse.json({ token, deviceId: device.id }, { status: 201 });
}
