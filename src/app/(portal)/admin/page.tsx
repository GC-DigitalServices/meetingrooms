import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DoorOpen, Tablet, ClipboardList, Activity } from "lucide-react";
import { db } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const SECTIONS = [
  { href: "/admin/rooms", icon: DoorOpen, title: "Meeting Rooms", desc: "Edit meeting room metadata and permissions" },
  { href: "/admin/devices", icon: Tablet, title: "Devices", desc: "Pair and manage iPad displays" },
  { href: "/admin/audit", icon: ClipboardList, title: "Audit log", desc: "Review all booking actions" },
  { href: "/admin/status", icon: Activity, title: "System status", desc: "Check infrastructure and display health" },
];

export default async function AdminPage() {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const expiringSoon = await db.graphSubscription.count({
    where: { expiresAt: { lte: in24h } },
  });

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight mb-6">Admin</h1>

      {expiringSoon > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <span>⚠</span>
          <p>
            <strong>{expiringSoon} Graph subscription{expiringSoon !== 1 ? "s" : ""} expiring within 24 hours.</strong>{" "}
            Real-time room updates may stop working.{" "}
            <Link href="/admin/status" className="underline hover:no-underline">
              View status →
            </Link>
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map(({ href, icon: Icon, title, desc }) => (
          <Link key={href} href={href}>
            <Card className="hover:shadow-md transition-shadow h-full">
              <CardHeader>
                <Icon className="h-6 w-6 text-primary mb-2" />
                <CardTitle className="text-base">{title}</CardTitle>
                <CardDescription className="text-xs">{desc}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
