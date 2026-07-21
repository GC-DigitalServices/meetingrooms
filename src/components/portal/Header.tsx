import Image from "next/image";
import type { Session } from "@/lib/auth/session";
import { UserMenu } from "@/components/portal/UserMenu";
import { NavLinks } from "@/components/portal/NavLinks";

interface Props {
  session: Session;
}

export default function Header({ session }: Props) {
  return (
    <header className="bg-primary text-on-primary fixed top-0 left-0 w-full z-50 h-20 flex items-center justify-between px-margin-mobile md:px-margin-desktop border-b border-primary-container/50">
      {/* Brand */}
      <div className="flex items-center gap-3">
        <Image
          src="/greenhead_college_logo.jpeg"
          alt="Greenhead College"
          width={160}
          height={56}
          className="object-contain h-12 w-auto"
          priority
        />
        <span className="text-lg font-semibold tracking-tight whitespace-nowrap">
          Meeting Rooms
        </span>
      </div>

      {/* Desktop nav */}
      <NavLinks isAdmin={session.isAdmin} isStaff={session.isStaff} />

      {/* Right: user menu */}
      <UserMenu displayName={session.displayName} />
    </header>
  );
}
