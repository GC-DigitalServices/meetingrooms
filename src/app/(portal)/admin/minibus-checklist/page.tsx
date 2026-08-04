import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getManagedFileMeta, MINIBUS_CHECKLIST_KEY } from "@/lib/db/managedFiles";
import { MinibusChecklistManager } from "./MinibusChecklistManager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function MinibusChecklistPage() {
  const meta = await getManagedFileMeta(MINIBUS_CHECKLIST_KEY);

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-lg pb-lg">
      <div className="max-w-2xl">
        <Link
          href="/admin"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Admin
        </Link>

        <h1 className="font-display font-extrabold text-headline-xl text-on-background mb-2">
          Minibus checklist
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          This document is attached to the confirmation email sent to the member of staff
          each time they book a minibus. Upload a new file here to replace it — the change
          takes effect immediately, no redeploy needed.
        </p>

        <MinibusChecklistManager
          current={
            meta && {
              filename: meta.filename,
              size: meta.size,
              uploadedBy: meta.uploadedBy,
              uploadedAt: meta.uploadedAt.toISOString(),
            }
          }
        />
      </div>
    </div>
  );
}
