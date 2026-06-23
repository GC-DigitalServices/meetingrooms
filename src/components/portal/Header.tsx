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
        <Link href="/" className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://www.greenhead.ac.uk/assets/images/global/logo@2x.png"
            alt="Greenhead College"
            className="h-9 object-contain"
          />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-lg">
          <Link href="/" className="text-on-primary font-medium hover:text-secondary-container transition-colors">
            Meeting Rooms
          </Link>
          <Link href="/bookings" className="text-on-primary font-medium hover:text-secondary-container transition-colors">
            My Bookings
          </Link>
          <Link href="/minibus" className="text-on-primary font-medium hover:text-secondary-container transition-colors">
            Minibus
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
