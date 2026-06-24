"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Props {
  isAdmin: boolean;
  isStaff: boolean;
}

export function NavLinks({ isAdmin, isStaff }: Props) {
  const pathname = usePathname();

  const links = [
    { href: "/", label: "Meeting Rooms" },
    { href: "/bookings", label: "My Bookings" },
    { href: "/minibus", label: "Minibus" },
    ...((isStaff || isAdmin) ? [{ href: "/carpark", label: "Car Park" }] : []),
    ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <nav className="hidden md:flex items-center gap-lg">
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={`text-sm font-semibold pb-0.5 transition-colors ${
            isActive(href)
              ? "text-secondary-fixed border-b-2 border-secondary-fixed"
              : "text-on-primary/80 hover:text-on-primary"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
