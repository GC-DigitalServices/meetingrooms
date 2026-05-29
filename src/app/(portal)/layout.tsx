import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import { getServerSession } from "@/lib/auth/server";
import { SocketProvider } from "@/lib/socket-context";
import Header from "@/components/portal/Header";
import Sidebar from "@/components/portal/Sidebar";
import BottomNav from "@/components/portal/BottomNav";
import ConnectionBanner from "@/components/portal/ConnectionBanner";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  return (
    <SocketProvider>
      <div className="min-h-screen bg-background">
        {/* Sticky top header */}
        <Header session={session} />

        {/* Fixed left sidebar (desktop) */}
        <Sidebar isAdmin={session.isAdmin} displayName={session.displayName} />

        {/* Connection degraded banner */}
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
