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
        <span className="bg-on-primary text-primary px-2 py-0.5 rounded-lg text-lg font-extrabold leading-none">
          gc
        </span>
        <span className="font-semibold text-base text-on-primary/90">Greenhead College</span>
      </div>

      {/* Desktop nav */}
      <NavLinks isAdmin={session.isAdmin} />

      {/* Right: user menu */}
      <UserMenu displayName={session.displayName} />
    </header>
  );
}
