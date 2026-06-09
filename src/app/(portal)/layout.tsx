import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import { getServerSession } from "@/lib/auth/server";
import { getRedisClient } from "@/lib/realtime/redis";
import { SocketProvider } from "@/lib/socket-context";
import Header from "@/components/portal/Header";
import Sidebar from "@/components/portal/Sidebar";
import BottomNav from "@/components/portal/BottomNav";
import ConnectionBanner from "@/components/portal/ConnectionBanner";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

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

        {/* Fixed left sidebar (desktop) */}
        <Sidebar isAdmin={session.isAdmin} displayName={session.displayName} />

        {/* Graph API degraded — booking writes are failing */}
        {graphDegraded && (
          <div className="bg-[#fff8e1] border-b border-[#ffe082] px-margin-mobile md:px-margin-desktop py-2 lg:ml-64">
            <p className="text-sm font-medium text-[#e65100]">
              ⚠ Booking service temporarily unavailable — new bookings may fail. Please try again shortly or contact IT.
            </p>
          </div>
        )}

        {/* WebSocket connection degraded banner */}
        <ConnectionBanner />

        {/* Main content — offset by sidebar width on lg */}
        <main className="lg:ml-64 p-margin-mobile md:p-md lg:p-lg pb-24 lg:pb-lg min-h-[calc(100vh-72px)]">
          {children}
        </main>

        {/* Mobile bottom navigation */}
        <BottomNav />
      </div>

      <Toaster richColors position="top-right" />
    </SocketProvider>
  );
}
