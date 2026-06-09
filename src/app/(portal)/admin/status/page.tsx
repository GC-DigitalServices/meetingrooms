import { db } from "@/lib/db/client";
import { getRedisClient } from "@/lib/realtime/redis";
import { graphClient } from "@/lib/graph/client";
import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { ChevronRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatLondon(date: Date, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...opts }).format(date);
}

async function withTimeout<T>(
  fn: () => Promise<T>,
  ms: number
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
      ),
    ]);
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function StatusRow({ label, up, error }: { label: string; up: boolean; error?: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span
        className={`inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${up ? "bg-green-500" : "bg-red-500"}`}
      />
      <span className="w-40 text-sm font-medium">{label}</span>
      <span className={`text-sm ${up ? "text-green-700" : "text-red-600"}`}>
        {up ? "Connected" : (error ?? "Unreachable")}
      </span>
    </div>
  );
}

export default async function StatusPage() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const [pgCheck, redisCheck, graphCheck, subsSettled, devicesSettled, activitySettled] =
    await Promise.allSettled([
      withTimeout(() => db.$queryRaw`SELECT 1 as one`, 5000),
      withTimeout(() => getRedisClient().ping(), 5000),
      withTimeout(
        () => graphClient.get<{ value: unknown[] }>("/subscriptions?$top=1"),
        10000
      ),
      db.graphSubscription.findMany({ orderBy: { expiresAt: "asc" } }),
      db.device.findMany({
        include: { room: { select: { displayName: true } } },
        orderBy: [{ room: { displayName: "asc" } }],
      }),
      db.auditLog.count({
        where: { action: "booking.create", at: { gte: yesterday } },
      }),
    ]);

  const pgOk = pgCheck.status === "fulfilled" && pgCheck.value.ok;
  const pgError = pgCheck.status === "fulfilled" && !pgCheck.value.ok ? pgCheck.value.error : undefined;

  const redisOk = redisCheck.status === "fulfilled" && redisCheck.value.ok;
  const redisError = redisCheck.status === "fulfilled" && !redisCheck.value.ok ? redisCheck.value.error : undefined;

  const graphOk = graphCheck.status === "fulfilled" && graphCheck.value.ok;
  const graphError = graphCheck.status === "fulfilled" && !graphCheck.value.ok ? graphCheck.value.error : undefined;

  const subList = subsSettled.status === "fulfilled" ? subsSettled.value : [];
  const subError = subsSettled.status === "rejected" ? String(subsSettled.reason) : null;

  const deviceList = devicesSettled.status === "fulfilled" ? devicesSettled.value : [];
  const deviceError = devicesSettled.status === "rejected" ? String(devicesSettled.reason) : null;

  const bookingsToday =
    activitySettled.status === "fulfilled" ? activitySettled.value : null;

  const expiringSoon = subList.filter((s) => s.expiresAt <= twentyFourHoursFromNow);
  const earliest = subList[0] ?? null;

  function deviceStatus(lastSeenAt: Date | null): "online" | "stale" | "offline" {
    if (!lastSeenAt) return "offline";
    if (lastSeenAt >= fiveMinAgo) return "online";
    if (lastSeenAt >= sixHoursAgo) return "stale";
    return "offline";
  }

  const statusStyle = {
    online: "text-green-700 bg-green-50",
    stale: "text-amber-700 bg-amber-50",
    offline: "text-red-700 bg-red-50",
  } as const;

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <nav className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Link href="/admin" className="hover:underline">
            Admin
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span>System status</span>
        </nav>
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">System status</h1>
          <span className="text-sm text-muted-foreground">
            Checked at{" "}
            {formatLondon(now, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" })}
          </span>
        </div>
      </div>

      {/* Infrastructure */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Infrastructure</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <StatusRow label="Postgres" up={pgOk} error={pgError} />
          <StatusRow label="Redis" up={redisOk} error={redisError} />
          <StatusRow label="Microsoft Graph" up={graphOk} error={graphError} />
        </CardContent>
      </Card>

      {/* Subscriptions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Graph Subscriptions</CardTitle>
        </CardHeader>
        <CardContent>
          {subError ? (
            <p className="text-sm text-red-600">Failed to load: {subError}</p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-sm">
                <span className="font-medium">{subList.length}</span>{" "}
                {subList.length === 1 ? "subscription" : "subscriptions"} active
              </p>
              {earliest && (
                <p className="text-sm text-muted-foreground">
                  Earliest expiry:{" "}
                  <span
                    className={
                      expiringSoon.length > 0 ? "font-medium text-amber-700" : ""
                    }
                  >
                    {formatLondon(earliest.expiresAt, {
                      weekday: "short", day: "numeric", month: "short",
                      year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
                    })}
                  </span>
                </p>
              )}
              {expiringSoon.length > 0 && (
                <p className="text-sm font-medium text-amber-700">
                  ⚠ {expiringSoon.length}{" "}
                  {expiringSoon.length === 1 ? "subscription" : "subscriptions"} expiring
                  within 24 hours
                </p>
              )}
              {subList.length === 0 && (
                <p className="text-sm font-medium text-red-600">
                  No subscriptions found — restart the server to trigger automatic
                  creation.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent activity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {bookingsToday === null ? (
            <p className="text-sm text-red-600">Failed to load activity data.</p>
          ) : (
            <p className="text-sm">
              <span className="font-medium">{bookingsToday}</span>{" "}
              {bookingsToday === 1 ? "booking" : "bookings"} created in the last 24 hours
            </p>
          )}
        </CardContent>
      </Card>

      {/* Displays */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Displays</CardTitle>
        </CardHeader>
        <CardContent>
          {deviceError ? (
            <p className="text-sm text-red-600">Failed to load: {deviceError}</p>
          ) : deviceList.length === 0 ? (
            <p className="text-sm text-muted-foreground">No devices enrolled.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="pb-2 text-left font-medium">Device / Room</th>
                  <th className="pb-2 text-left font-medium">Scope</th>
                  <th className="pb-2 text-left font-medium">Last seen</th>
                  <th className="pb-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {deviceList.map((d) => {
                  const st = deviceStatus(d.lastSeenAt);
                  return (
                    <tr key={d.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">
                        {d.name ?? d.room.displayName}
                      </td>
                      <td className="py-2 pr-4 capitalize text-muted-foreground">
                        {d.scope.toLowerCase()}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {d.lastSeenAt
                          ? formatDistanceToNowStrict(d.lastSeenAt, { addSuffix: true })
                          : "Never"}
                      </td>
                      <td className="py-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle[st]}`}
                        >
                          {st.charAt(0).toUpperCase() + st.slice(1)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
