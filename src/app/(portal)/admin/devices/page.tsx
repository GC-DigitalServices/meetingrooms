import Link from "next/link";
import { db } from "@/lib/db/client";
import { Badge } from "@/components/ui/badge";
import { PairDeviceDialog } from "./PairDeviceDialog";
import { RevokeButton } from "./RevokeButton";

export const runtime = "nodejs";

const SCOPE_LABEL: Record<string, string> = {
  STANDARD: "Standard",
  SECTION: "Section",
  COMPOSITE: "Composite",
};

export default async function AdminDevicesPage() {
  const [devices, rooms] = await Promise.all([
    db.device.findMany({
      include: { room: { select: { displayName: true, building: true } } },
      orderBy: { enrolledAt: "desc" },
    }),
    db.room.findMany({
      where: { kind: { not: "MINIBUS" } },
      select: { id: true, displayName: true, building: true, kind: true },
      orderBy: [{ building: "asc" }, { displayName: "asc" }],
    }),
  ]);

  const fmt = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat("en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Europe/London",
        }).format(d)
      : "Never";

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-lg pb-lg">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Devices</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {devices.length} enrolled display{devices.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PairDeviceDialog rooms={rooms} />
          <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">
            ← Admin
          </Link>
        </div>
      </div>

      {devices.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground text-sm">
          No displays paired yet. Click <strong>Pair display</strong> to get started.
        </div>
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
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {devices.map((d) => (
                <tr key={d.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium">{d.name ?? "Unnamed display"}</div>
                    <div className="text-xs text-muted-foreground font-mono">{d.id.slice(0, 8)}</div>
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
                  <td className="px-4 py-3 text-muted-foreground text-xs">{fmt(d.lastSeenAt)}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {new Intl.DateTimeFormat("en-GB", {
                      dateStyle: "medium",
                      timeZone: "Europe/London",
                    }).format(d.enrolledAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <RevokeButton
                      deviceId={d.id}
                      deviceLabel={d.name ?? d.room.displayName}
                    />
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
