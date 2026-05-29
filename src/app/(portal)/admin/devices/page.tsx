import Link from "next/link";
import { db } from "@/lib/db/client";
import { Badge } from "@/components/ui/badge";

export const runtime = "nodejs";

const SCOPE_LABEL: Record<string, string> = {
  STANDARD: "Standard",
  SECTION: "Section",
  COMPOSITE: "Composite",
};

export default async function AdminDevicesPage() {
  const devices = await db.device.findMany({
    include: { room: { select: { displayName: true, building: true } } },
    orderBy: { enrolledAt: "desc" },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Devices</h1>
          <p className="text-sm text-muted-foreground mt-1">{devices.length} enrolled devices</p>
        </div>
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">
          ← Admin
        </Link>
      </div>

      {devices.length === 0 ? (
        <p className="text-muted-foreground text-sm">No devices enrolled yet.</p>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Device</th>
                <th className="text-left px-4 py-3 font-medium">Room</th>
                <th className="text-left px-4 py-3 font-medium">Scope</th>
                <th className="text-left px-4 py-3 font-medium">Last seen</th>
                <th className="text-left px-4 py-3 font-medium">Enrolled</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {devices.map((d) => (
                <tr key={d.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium font-mono text-xs">
                    {d.name ?? d.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {d.room.displayName}
                    {d.room.building && (
                      <span className="text-xs ml-1">({d.room.building})</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-xs">
                      {SCOPE_LABEL[d.scope] ?? d.scope}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {d.lastSeenAt
                      ? new Intl.DateTimeFormat("en-GB", {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: "Europe/London",
                        }).format(d.lastSeenAt)
                      : "Never"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {new Intl.DateTimeFormat("en-GB", {
                      dateStyle: "medium",
                      timeZone: "Europe/London",
                    }).format(d.enrolledAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
