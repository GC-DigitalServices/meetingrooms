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
    { href: "/", label: "Home" },
    { href: "/bookings", label: "My Bookings" },
    { href: "/minibus", label: "Minibus" },
    ...(isStaff || isAdmin ? [{ href: "/carpark", label: "Visitor Car Park" }] : []),
    ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <>
      {/* ▼▼▼ CHANGE ONLY THESE LINKS for your app ▼▼▼ */}
      <nav className="gh-nav-links">
        {links.map(({ href, label }) => (
          <Link key={href} href={href} className={`gh-nav-link${isActive(href) ? " active" : ""}`}>
            {label}
          </Link>
        ))}
      </nav>
      {/* ▲▲▲ CHANGE ONLY THESE LINKS ▲▲▲ */}
    </>
  );
}
