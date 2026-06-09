import { randomBytes } from "crypto";
import { db } from "@/lib/db/client";
import { graphClient } from "@/lib/graph/client";
import type { GraphSubscriptionResponse } from "@/lib/graph/types";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";

// Graph's maximum subscription lifetime for calendar resources is 4230 minutes.
const SUBSCRIPTION_LIFETIME_MINUTES = 4230;

function expirationDateTime(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + SUBSCRIPTION_LIFETIME_MINUTES);
  return d.toISOString();
}

export async function createSubscriptionForRoom(roomId: string): Promise<void> {
  const room = await db.room.findUniqueOrThrow({ where: { id: roomId } });

  // COMPOSITE rooms have no mailbox — subscriptions belong to their sections.
  if (room.kind === "COMPOSITE" || !room.mailboxUpn) return;

  const clientState = randomBytes(32).toString("hex");
  const cfg = getConfig();

  const sub = await graphClient.post<GraphSubscriptionResponse>("/subscriptions", {
    changeType: "created,updated,deleted",
    notificationUrl: `${cfg.PUBLIC_BASE_URL}/api/webhooks/graph`,
    resource: `/users/${room.mailboxUpn}/events`,
    expirationDateTime: expirationDateTime(),
    clientState,
  });

  await db.graphSubscription.create({
    data: {
      id: sub.id,
      resource: sub.resource,
      roomId,
      expiresAt: new Date(sub.expirationDateTime),
      clientState,
    },
  });

  logger.info({ roomId, subscriptionId: sub.id }, "graph: subscription created");
}

export async function renewExpiringSubscriptions(): Promise<{ renewed: number; failed: number }> {
  const threshold = new Date();
  threshold.setHours(threshold.getHours() + 24);

  const expiring = await db.graphSubscription.findMany({
    where: { expiresAt: { lte: threshold } },
  });

  let renewed = 0;
  let failed = 0;

  for (const sub of expiring) {
    try {
      const newExpiry = expirationDateTime();
      await graphClient.patch(`/subscriptions/${sub.id}`, {
        expirationDateTime: newExpiry,
      });
      await db.graphSubscription.update({
        where: { id: sub.id },
        data: { expiresAt: new Date(newExpiry) },
      });
      logger.info({ subscriptionId: sub.id }, "graph: subscription renewed");
      renewed++;
    } catch (err) {
      logger.error({ subscriptionId: sub.id, err }, "graph: failed to renew subscription");
      failed++;
    }
  }

  return { renewed, failed };
}

// Called on startup: creates subscriptions for any bookable mailbox room
// that doesn't already have one.
export async function ensureSubscriptionsForAllRooms(): Promise<void> {
  const rooms = await db.room.findMany({
    where: { kind: { not: "COMPOSITE" }, mailboxUpn: { not: null }, bookable: true },
  });

  const existing = await db.graphSubscription.findMany({ select: { roomId: true } });
  const subscribedIds = new Set(existing.map((s) => s.roomId));

  for (const room of rooms) {
    if (subscribedIds.has(room.id)) continue;
    try {
      await createSubscriptionForRoom(room.id);
    } catch (err) {
      logger.error({ roomId: room.id, err }, "graph: failed to create subscription on startup");
    }
  }
}
