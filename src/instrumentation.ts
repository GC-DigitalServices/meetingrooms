// Next.js instrumentation hook — runs once when the server process starts.
// Used to initialise background jobs that need to run for the lifetime of the process.

export async function register() {
  // Only run in the Node.js runtime (not Edge) and not during build.
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NODE_ENV !== "test"
  ) {
    const { startCronJobs } = await import("@/lib/cron");
    startCronJobs();
  }
}
