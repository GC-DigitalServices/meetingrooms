"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  icon: string;
  label: string;
  soon?: boolean;
}

const NAV: NavItem[] = [
  { href: "/", icon: "search", label: "Room Finder" },
  { href: "/bookings", icon: "event_note", label: "My Bookings" },
  { href: "/minibus", icon: "directions_bus", label: "Minibus", soon: true },
  { href: "/profile", icon: "person", label: "Profile" },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/admin", icon: "admin_panel_settings", label: "Admin" },
];

interface Props {
  isAdmin: boolean;
  displayName: string;
}

export default function Sidebar({ isAdmin, displayName }: Props) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside className="bg-surface-container-low text-label-md font-label-md h-screen w-64 fixed left-0 top-0 pt-[72px] hidden lg:flex flex-col p-md gap-base shadow-md z-40">
      {/* Navigation */}
      <nav className="flex flex-col gap-1 flex-grow mt-2">
        {NAV.map(({ href, icon, label, soon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center justify-between gap-md p-3 rounded-xl font-label-md text-label-md transition-all",
              isActive(href)
                ? "bg-secondary-container text-on-secondary-container font-bold"
                : "text-on-surface-variant hover:bg-surface-variant"
            )}
          >
            <span className="flex items-center gap-md">
              <span className={cn("material-symbols-outlined", isActive(href) && "filled")}>
                {icon}
              </span>
              {label}
            </span>
            {soon && (
              <span className="text-[10px] font-bold bg-outline-variant text-on-surface px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                Soon
              </span>
            )}
          </Link>
        ))}

        {isAdmin &&
          ADMIN_NAV.map(({ href, icon, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-md p-3 rounded-xl font-label-md text-label-md transition-all",
                isActive(href)
                  ? "bg-secondary-container text-on-secondary-container font-bold"
                  : "text-on-surface-variant hover:bg-surface-variant"
              )}
            >
              <span className="material-symbols-outlined">{icon}</span>
              {label}
            </Link>
          ))}
      </nav>

      {/* Bottom actions */}
      <div className="border-t border-outline-variant pt-md flex flex-col gap-1">
        <div className="px-3 py-2 text-xs text-on-surface-variant truncate">{displayName}</div>
        <a
          href="/api/auth/logout"
          className="flex items-center gap-md p-3 text-on-surface-variant hover:bg-surface-variant rounded-xl transition-all"
        >
          <span className="material-symbols-outlined">logout</span>
          Sign out
        </a>
      </div>
    </aside>
  );
}
