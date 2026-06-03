import cron from "node-cron";
import { renewExpiringSubscriptions, ensureSubscriptionsForAllRooms } from "@/lib/graph/subscriptions";
import { fullResync } from "@/lib/graph/sync";
import { db } from "@/lib/db/client";
import { logger } from "@/lib/logger";

export function startCronJobs(): void {
  // Subscription renewal — every 6 hours.
  cron.schedule("0 */6 * * *", async () => {
    logger.info("cron: subscription renewal starting");
    try {
      await renewExpiringSubscriptions();
    } catch (err) {
      logger.error({ err }, "cron: subscription renewal failed");
    }
  });

  // Full resync — nightly at 02:00.
  cron.schedule("0 2 * * *", async () => {
    logger.info("cron: full resync starting");
    try {
      await fullResync();
    } catch (err) {
      logger.error({ err }, "cron: full resync failed");
    }
  });

  // Device heartbeat check — every 15 minutes.
  // Flags devices that have been silent for >2h; logs an alert if >6h.
  cron.schedule("*/15 * * * *", async () => {
    try {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

      const silent = await db.device.findMany({
        where: {
          OR: [
            { lastSeenAt: { lt: twoHoursAgo } },
            { lastSeenAt: null },
          ],
        },
        include: { room: { select: { displayName: true } } },
      });

      for (const device of silent) {
        const label = device.name ?? device.room.displayName;
        const lastSeen = device.lastSeenAt?.toISOString() ?? "never";
        const isCritical = !device.lastSeenAt || device.lastSeenAt < sixHoursAgo;

        if (isCritical) {
          logger.error({ deviceId: device.id, label, lastSeen }, "cron: device_silent_critical (>6h)");
        } else {
          logger.warn({ deviceId: device.id, label, lastSeen }, "cron: device_silent_warning (>2h)");
        }
      }
    } catch (err) {
      logger.error({ err }, "cron: device heartbeat check failed");
    }
  });

  logger.info("cron: jobs scheduled (subscription renewal every 6h, full resync at 02:00, device check every 15m)");

  // Ensure subscriptions exist for all rooms on startup.
  (async () => {
    // Dev mode: Next.js compiles routes lazily on first request. Pre-warm the
    // webhook route so it is already compiled when Graph's validation request
    // arrives — otherwise Graph times out waiting for a response.
    if (process.env.NODE_ENV !== "production") {
      const { getConfig } = await import("@/lib/config");
      const { PUBLIC_BASE_URL } = getConfig();
      await fetch(`${PUBLIC_BASE_URL}/api/webhooks/graph`).catch(() => {});
      await new Promise<void>((r) => setTimeout(r, 500));
    }
    await ensureSubscriptionsForAllRooms();
  })().catch((err) => {
    logger.error({ err }, "cron: startup subscription check failed");
  });
}
