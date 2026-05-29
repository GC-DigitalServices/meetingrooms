import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import { getServerSession } from "@/lib/auth/server";
import { SocketProvider } from "@/lib/socket-context";
import Header from "@/components/portal/Header";
import ConnectionBanner from "@/components/portal/ConnectionBanner";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  return (
    <SocketProvider>
      <div className="min-h-screen flex flex-col bg-background">
        <Header session={session} />
        <ConnectionBanner />
        <main className="flex-1 container mx-auto px-4 py-6 max-w-7xl">{children}</main>
      </div>
      <Toaster richColors position="top-right" />
    </SocketProvider>
  );
}
