import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DoorOpen, Tablet, ClipboardList } from "lucide-react";

const SECTIONS = [
  { href: "/admin/rooms", icon: DoorOpen, title: "Rooms", desc: "Edit room metadata and permissions" },
  { href: "/admin/devices", icon: Tablet, title: "Devices", desc: "Pair and manage iPad displays" },
  { href: "/admin/audit", icon: ClipboardList, title: "Audit log", desc: "Review all booking actions" },
];

export default function AdminPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight mb-6">Admin</h1>
      <div className="grid gap-4 sm:grid-cols-3">
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
