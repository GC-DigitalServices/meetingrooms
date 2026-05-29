import Link from "next/link";
import { db } from "@/lib/db/client";
import { Badge } from "@/components/ui/badge";
import { Users, Lock } from "lucide-react";

export const runtime = "nodejs";

const KIND_LABEL: Record<string, string> = {
  STANDARD: "Standard",
  COMPOSITE: "Composite",
  SECTION: "Section",
  MINIBUS: "Minibus",
};

export default async function AdminRoomsPage() {
  const rooms = await db.room.findMany({
    include: { sections: { select: { id: true } } },
    orderBy: [{ building: "asc" }, { displayName: "asc" }],
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rooms</h1>
          <p className="text-sm text-muted-foreground mt-1">{rooms.length} rooms configured</p>
        </div>
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">
          ← Admin
        </Link>
      </div>

      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Room</th>
              <th className="text-left px-4 py-3 font-medium">Building</th>
              <th className="text-left px-4 py-3 font-medium">Capacity</th>
              <th className="text-left px-4 py-3 font-medium">Type</th>
              <th className="text-left px-4 py-3 font-medium">Access</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rooms.map((room) => (
              <tr key={room.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium">{room.displayName}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {[room.building, room.floor].filter(Boolean).join(", ") || "—"}
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    {room.capacity}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className="text-xs">
                    {KIND_LABEL[room.kind] ?? room.kind}
                    {room.sections.length > 0 && ` (${room.sections.length} sections)`}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {room.allowedGroups.length === 0 ? (
                    <span className="text-muted-foreground text-xs">All users</span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="h-3 w-3" />
                      {room.allowedGroups.length} group{room.allowedGroups.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={room.bookable ? "default" : "secondary"} className="text-xs">
                    {room.bookable ? "Bookable" : "Disabled"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Room configuration is managed in{" "}
        <code className="bg-muted px-1 py-0.5 rounded">config/rooms.yaml</code>. Changes require a
        redeploy.
      </p>
    </div>
  );
}
