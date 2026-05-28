import cron from "node-cron";
import { renewExpiringSubscriptions, ensureSubscriptionsForAllRooms } from "@/lib/graph/subscriptions";
import { fullResync } from "@/lib/graph/sync";
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

  logger.info("cron: jobs scheduled (subscription renewal every 6h, full resync at 02:00)");

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
