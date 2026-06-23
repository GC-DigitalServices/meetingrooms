import Link from "next/link";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

const PAGE_SIZE = 50;

const ACTION_LABEL: Record<string, string> = {
  "booking.create": "Created booking",
  "booking.update": "Updated booking",
  "booking.cancel": "Cancelled booking",
};

const fmt = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/London",
});

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; date?: string; page?: string }>;
}) {
  const { action, date, page: pageParam } = await searchParams;
  const page = Math.max(0, parseInt(pageParam ?? "0", 10) || 0);

  const where: { action?: string; at?: { gte: Date; lt: Date } } = {};
  if (action) where.action = action;
  if (date) {
    const d = new Date(date);
    if (!isNaN(d.getTime())) {
      where.at = {
        gte: new Date(date + "T00:00:00.000Z"),
        lt: new Date(date + "T24:00:00.000Z"),
      };
    }
  }

  const [logs, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { at: "desc" },
      take: PAGE_SIZE,
      skip: page * PAGE_SIZE,
    }),
    db.auditLog.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function buildHref(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const p = overrides.page ?? String(page);
    const a = "action" in overrides ? overrides.action : action;
    const d = "date" in overrides ? overrides.date : date;
    if (a) params.set("action", a);
    if (d) params.set("date", d);
    if (p && p !== "0") params.set("page", p);
    const qs = params.toString();
    return `/admin/audit${qs ? `?${qs}` : ""}`;
  }

  const hasFilters = !!(action || date);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} event{total !== 1 ? "s" : ""}{hasFilters ? " matching filters" : ""}
          </p>
        </div>
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">
          ← Admin
        </Link>
      </div>

      {/* Filters */}
      <form method="GET" className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Action</label>
          <select
            name="action"
            defaultValue={action ?? ""}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All actions</option>
            <option value="booking.create">Created</option>
            <option value="booking.update">Updated</option>
            <option value="booking.cancel">Cancelled</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Date</label>
          <input
            type="date"
            name="date"
            defaultValue={date ?? ""}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <input type="hidden" name="page" value="0" />
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Filter
        </button>
        {hasFilters && (
          <Link
            href="/admin/audit"
            className="px-1 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Clear
          </Link>
        )}
      </form>

      {logs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No audit events found.</p>
      ) : (
        <>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Time</th>
                  <th className="px-4 py-3 text-left font-medium">Actor</th>
                  <th className="px-4 py-3 text-left font-medium">Action</th>
                  <th className="px-4 py-3 text-left font-medium">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((log) => {
                  const meta = log.metadata as Record<string, unknown>;
                  return (
                    <tr key={log.id} className="transition-colors hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {fmt.format(log.at)}
                      </td>
                      <td className="max-w-[160px] truncate px-4 py-3 font-mono text-xs">
                        {log.actor}
                      </td>
                      <td className="px-4 py-3">
                        {ACTION_LABEL[log.action] ?? log.action}
                        {!!meta.adminOverride && (
                          <span className="ml-1 text-xs font-medium text-amber-600">(admin override)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {!!meta.roomId && <span>Room: {String(meta.roomId)}</span>}
                        {!!meta.start && (
                          <span className="ml-2">
                            {fmt.format(new Date(String(meta.start)))}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Page {page + 1} of {totalPages}
              </span>
              <div className="flex gap-3">
                {page > 0 && (
                  <Link
                    href={buildHref({ page: String(page - 1) })}
                    className="text-primary hover:underline"
                  >
                    ← Previous
                  </Link>
                )}
                {page < totalPages - 1 && (
                  <Link
                    href={buildHref({ page: String(page + 1) })}
                    className="text-primary hover:underline"
                  >
                    Next →
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
