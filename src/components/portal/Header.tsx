import Link from "next/link";
import type { Session } from "@/lib/auth/session";

interface Props {
  session: Session;
}

export default function Header({ session }: Props) {
  return (
    <header className="bg-primary text-on-primary sticky top-0 z-50 w-full border-b border-primary-container shadow-sm">
      <div className="flex justify-between items-center w-full px-margin-mobile md:px-margin-desktop py-4">
        {/* Brand */}
        <div className="flex items-center gap-base">
          <span className="font-display font-extrabold text-headline-md text-on-primary tracking-tight">
            Greenhead College
          </span>
        </div>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-lg">
          <Link href="/" className="text-on-primary font-medium hover:text-secondary-container transition-colors">
            Rooms
          </Link>
          <Link href="/bookings" className="text-on-primary font-medium hover:text-secondary-container transition-colors">
            My Bookings
          </Link>
          <Link href="/minibus" className="text-on-primary/60 font-medium hover:text-secondary-container transition-colors flex items-center gap-1">
            Minibus
            <span className="text-[10px] bg-secondary-container text-on-secondary-container px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide">
              Soon
            </span>
          </Link>
          {session.isAdmin && (
            <Link href="/admin" className="text-on-primary font-medium hover:text-secondary-container transition-colors">
              Admin
            </Link>
          )}
        </nav>

        {/* Right: user chip */}
        <div className="flex items-center gap-md">
          <div className="flex items-center gap-2 bg-primary-container px-3 py-1.5 rounded-full text-on-primary text-label-sm">
            <span className="material-symbols-outlined text-sm">person</span>
            <span className="hidden sm:inline max-w-[120px] truncate">{session.displayName}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
