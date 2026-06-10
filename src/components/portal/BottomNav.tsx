"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", icon: "search", label: "Rooms" },
  { href: "/bookings", icon: "event_note", label: "Bookings" },
  { href: "/minibus", icon: "directions_bus", label: "Minibus" },
  { href: "/profile", icon: "person", label: "Profile" },
];

export default function BottomNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-4 py-2 bg-surface shadow-lg border-t border-outline-variant rounded-t-xl">
      {NAV.map(({ href, icon, label }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 px-4 py-1 rounded-full transition-all active:scale-90",
            isActive(href)
              ? "bg-secondary-container text-on-secondary-container"
              : "text-on-surface-variant"
          )}
        >
          <span className={cn("material-symbols-outlined text-xl", isActive(href) && "filled")}>
            {icon}
          </span>
          <span className="text-label-sm font-label-sm">{label}</span>
        </Link>
      ))}
    </nav>
  );
}
