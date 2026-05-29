import Link from "next/link";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

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

export default async function AdminAuditPage() {
  const logs = await db.auditLog.findMany({
    orderBy: { at: "desc" },
    take: 200,
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Most recent 200 events
          </p>
        </div>
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">
          ← Admin
        </Link>
      </div>

      {logs.length === 0 ? (
        <p className="text-muted-foreground text-sm">No audit events yet.</p>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Time</th>
                <th className="text-left px-4 py-3 font-medium">Actor</th>
                <th className="text-left px-4 py-3 font-medium">Action</th>
                <th className="text-left px-4 py-3 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((log) => {
                const meta = log.metadata as Record<string, unknown>;
                return (
                  <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                      {fmt.format(log.at)}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono truncate max-w-[160px]">
                      {log.actor}
                    </td>
                    <td className="px-4 py-3">
                      {ACTION_LABEL[log.action] ?? log.action}
                      {!!meta.adminOverride && (
                        <span className="ml-1 text-xs text-amber-600 font-medium">(admin override)</span>
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
      )}
    </div>
  );
}
