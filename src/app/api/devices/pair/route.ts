import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError, ForbiddenError } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { getRedisClient } from "@/lib/realtime/redis";
import { getConfig } from "@/lib/config";
import { apiError } from "@/lib/api/errors";
import { z } from "zod";
import crypto from "crypto";

export const runtime = "nodejs";

const PairSchema = z.object({
  roomId: z.string().min(1),
  scope: z.enum(["STANDARD", "SECTION", "COMPOSITE"]),
  name: z.string().max(100).optional(),
});

/**
 * POST /api/devices/pair — admin generates a 6-digit pairing code.
 * The code is stored in Redis with a 10-minute TTL and is single-use.
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    await requireAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHENTICATED", err.message);
    if (err instanceof ForbiddenError) return apiError("FORBIDDEN", err.message);
    throw err;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid request body");
  }

  const parsed = PairSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "Validation failed", { details: parsed.error.flatten() });
  }

  const { roomId, scope, name } = parsed.data;

  const room = await db.room.findUnique({ where: { id: roomId }, select: { id: true, displayName: true } });
  if (!room) return apiError("NOT_FOUND", "Room not found");

  const code = String(crypto.randomInt(100000, 999999));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await getRedisClient().set(
    `device:pair:${code}`,
    JSON.stringify({ roomId, scope, name: name ?? null }),
    "EX",
    600,
  );

  const { PUBLIC_BASE_URL } = getConfig();
  const enrollUrl = `${PUBLIC_BASE_URL}/display/enroll?code=${code}`;

  return NextResponse.json({
    code,
    expiresAt: expiresAt.toISOString(),
    enrollUrl,
    roomName: room.displayName,
  });
}
