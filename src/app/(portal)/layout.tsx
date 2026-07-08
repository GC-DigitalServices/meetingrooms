import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import { getServerSession } from "@/lib/auth/server";
import { getRedisClient } from "@/lib/realtime/redis";
import { SocketProvider } from "@/lib/socket-context";
import Header from "@/components/portal/Header";
import BottomNav from "@/components/portal/BottomNav";
import ConnectionBanner from "@/components/portal/ConnectionBanner";

// Installable PWA — students often land here from a QR scan on their phone.
// The display app has its own manifest at /manifest.json.
export const metadata: Metadata = {
  manifest: "/portal.webmanifest",
};

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  // First-time users must accept the terms of use before accessing the portal.
  // The /terms page lives outside this layout to avoid an infinite redirect loop.
  if (!session.termsAccepted) redirect("/terms");

  let graphDegraded = false;
  try {
    graphDegraded = !!(await getRedisClient().get("graph:degraded"));
  } catch {
    // Redis unavailable — don't block page render
  }

  return (
    <SocketProvider>
      <div className="min-h-screen bg-background">
        {/* Sticky top header */}
        <Header session={session} />

        {/* Graph API degraded — booking writes are failing */}
        {graphDegraded && (
          <div className="bg-[#fff8e1] border-b border-[#ffe082] px-margin-mobile md:px-margin-desktop py-2">
            <p className="text-sm font-medium text-[#e65100]">
              ⚠ Booking service temporarily unavailable — new bookings may fail. Please try again
              shortly or contact IT.
            </p>
          </div>
        )}

        {/* WebSocket connection degraded banner */}
        <ConnectionBanner />

        {/* Main content */}
        <main className="pt-20 min-h-screen pb-24 sm:pb-0">{children}</main>

        {/* Mobile bottom navigation */}
        <BottomNav />
      </div>

      <Toaster richColors position="top-right" />
    </SocketProvider>
  );
}
