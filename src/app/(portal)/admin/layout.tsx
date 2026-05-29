import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/server";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session?.isAdmin) redirect("/");
  return <>{children}</>;
}
