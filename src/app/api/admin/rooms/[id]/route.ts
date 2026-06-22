import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError, ForbiddenError } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { apiError } from "@/lib/api/errors";
import { writeAudit } from "@/lib/db/audit";
import { createSubscriptionForRoom } from "@/lib/graph/subscriptions";
import { graphClient } from "@/lib/graph/client";
import { logger } from "@/lib/logger";
import { z } from "zod";

export const runtime = "nodejs";

const PatchSchema = z.object({
  displayName:   z.string().min(1).max(100).optional(),
  mailboxUpn:    z.string().email().nullable().optional(),
  building:      z.string().max(100).nullable().optional(),
  floor:         z.string().max(50).nullable().optional(),
  capacity:      z.number().int().min(1).optional(),
  equipment:     z.array(z.string()).optional(),
  bookable:      z.boolean().optional(),
  allowedGroups: z.array(z.string()).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  let session;
  try {
    session = await requireAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return apiError("UNAUTHENTICATED", err.message);
    if (err instanceof ForbiddenError) return apiError("FORBIDDEN", err.message);
    throw err;
  }

  const { id } = await params;

  const existing = await db.room.findUnique({ where: { id } });
  if (!existing) return apiError("NOT_FOUND", "Room not found");

  let body: unknown;
  try { body = await req.json(); } catch { return apiError("VALIDATION_ERROR", "Invalid request body"); }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Validation failed", { details: parsed.error.flatten() });

  const data = parsed.data;
  const mailboxChanging = "mailboxUpn" in data && data.mailboxUpn !== existing.mailboxUpn;

  if (mailboxChanging) {
    // Remove old subscription
    const sub = await db.graphSubscription.findFirst({ where: { roomId: id } });
    if (sub) {
      try {
        await graphClient.delete(`/subscriptions/${sub.id}`);
      } catch (err) {
        logger.warn({ subscriptionId: sub.id, err }, "admin: failed to delete old Graph subscription");
      }
      await db.graphSubscription.deleteMany({ where: { roomId: id } });
    }
  }

  const updated = await db.room.update({
    where: { id },
    data: {
      ...(data.displayName   !== undefined && { displayName:   data.displayName }),
      ...("mailboxUpn"  in data            && { mailboxUpn:    data.mailboxUpn ?? null }),
      ...("building"    in data            && { building:      data.building ?? null }),
      ...("floor"       in data            && { floor:         data.floor ?? null }),
      ...(data.capacity      !== undefined && { capacity:      data.capacity }),
      ...(data.equipment     !== undefined && { equipment:     data.equipment }),
      ...(data.bookable      !== undefined && { bookable:      data.bookable }),
      ...(data.allowedGroups !== undefined && { allowedGroups: data.allowedGroups }),
    },
  });

  if (mailboxChanging && data.mailboxUpn) {
    try {
      await createSubscriptionForRoom(id);
    } catch (err) {
      logger.warn({ roomId: id, err }, "admin: failed to create new Graph subscription after mailbox change");
    }
  }

  await writeAudit({
    actor:    session.upn,
    action:   "room.update",
    targetId: id,
    metadata: { changes: data },
  });

  return NextResponse.json(updated);
}
