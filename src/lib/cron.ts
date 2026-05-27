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
  ensureSubscriptionsForAllRooms().catch((err) => {
    logger.error({ err }, "cron: startup subscription check failed");
  });
}
