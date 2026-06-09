import cron from "node-cron";
import { renewExpiringSubscriptions, ensureSubscriptionsForAllRooms } from "@/lib/graph/subscriptions";
import { fullResync } from "@/lib/graph/sync";
import { db } from "@/lib/db/client";
import { getRedisClient } from "@/lib/realtime/redis";
import { sendAdminAlert } from "@/lib/mailer";
import { logger } from "@/lib/logger";

export function startCronJobs(): void {
  // Subscription renewal — every 6 hours.
  cron.schedule("0 */6 * * *", async () => {
    logger.info("cron: subscription renewal starting");
    try {
      const result = await renewExpiringSubscriptions();
      logger.info(result, "cron: subscription renewal complete");
      if (result.failed === 0) {
        getRedisClient().del("cron:sub_renew_fail_streak").catch(() => {});
      } else {
        try {
          const redis = getRedisClient();
          const streak = await redis.incr("cron:sub_renew_fail_streak");
          await redis.expire("cron:sub_renew_fail_streak", 60 * 60 * 24);
          if (streak >= 2) {
            sendAdminAlert(
              "Subscription renewal failures",
              `${result.failed} subscription(s) failed to renew (${streak} consecutive failing runs).\n\n` +
              `Bookings will stop syncing when subscriptions expire. Check Graph API connectivity and service account permissions.`
            ).catch(() => {});
          }
        } catch {
          // Redis unavailable — streak tracking skipped
        }
      }
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
      sendAdminAlert(
        "Nightly resync failed",
        `The nightly Graph→Postgres resync failed.\n\n` +
        `Bookings may be out of sync with Exchange. Investigate immediately.\n\n` +
        `Error: ${err instanceof Error ? err.message : String(err)}`
      ).catch(() => {});
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
          // Alert once per 8h per device to avoid repeated emails
          try {
            const redis = getRedisClient();
            const alertKey = `cron:device_alerted:${device.id}`;
            const alreadyAlerted = await redis.get(alertKey);
            if (!alreadyAlerted) {
              await redis.set(alertKey, "1", "EX", 60 * 60 * 8);
              sendAdminAlert(
                `Display offline: ${label}`,
                `The display "${label}" has not sent a heartbeat since ${lastSeen}.\n\n` +
                `Check the iPad is powered on and connected to the network.\n\n` +
                `Device ID: ${device.id}`
              ).catch(() => {});
            }
          } catch {
            // Redis unavailable — skip alert
          }
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
