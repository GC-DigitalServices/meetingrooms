import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError, ForbiddenError } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { apiError } from "@/lib/api/errors";
import { writeAudit } from "@/lib/db/audit";
import { createSubscriptionForRoom } from "@/lib/graph/subscriptions";
import { logger } from "@/lib/logger";
import { z } from "zod";

export const runtime = "nodejs";

const RoomSchema = z.object({
  displayName:   z.string().min(1).max(100),
  mailboxUpn:    z.string().email().nullable().optional(),
  building:      z.string().max(100).nullable().optional(),
  floor:         z.string().max(50).nullable().optional(),
  capacity:      z.number().int().min(1),
  equipment:     z.array(z.string()).default([]),
  bookable:      z.boolean().default(true),
  kind:          z.enum(["STANDARD", "MINIBUS", "PARKING", "PARKING_BAY"]),
  parentRoomId:  z.string().min(1).nullable().optional(),
  allowedGroups: z.array(z.string()).default([]),
});

export async function GET(req: NextRequest): Promise<Response> {
  try {
    await requireAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHENTICATED", err.message);
    if (err instanceof ForbiddenError) return apiError("FORBIDDEN", err.message);
    throw err;
  }

  const rooms = await db.room.findMany({
    orderBy: [{ building: "asc" }, { displayName: "asc" }],
  });

  return NextResponse.json(rooms);
}

export async function POST(req: NextRequest): Promise<Response> {
  let session;
  try {
    session = await requireAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHENTICATED", err.message);
    if (err instanceof ForbiddenError) return apiError("FORBIDDEN", err.message);
    throw err;
  }

  let body: unknown;
  try { body = await req.json(); } catch { return apiError("VALIDATION_ERROR", "Invalid request body"); }

  const parsed = RoomSchema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Validation failed", { details: parsed.error.flatten() });

  const { displayName, mailboxUpn, building, floor, capacity, equipment, bookable, kind, parentRoomId, allowedGroups } = parsed.data;

  const room = await db.room.create({
    data: {
      displayName,
      mailboxUpn:    mailboxUpn ?? null,
      building:      building ?? null,
      floor:         floor ?? null,
      capacity,
      equipment,
      bookable,
      kind,
      parentRoomId:  parentRoomId ?? null,
      allowedGroups,
    },
  });

  if (mailboxUpn) {
    try {
      await createSubscriptionForRoom(room.id);
    } catch (err) {
      logger.warn({ roomId: room.id, err }, "admin: failed to create Graph subscription for new room");
    }
  }

  await writeAudit({
    actor:    session.upn,
    action:   "room.create",
    targetId: room.id,
    metadata: { displayName, kind, mailboxUpn: mailboxUpn ?? null },
  });

  return NextResponse.json(room, { status: 201 });
}
