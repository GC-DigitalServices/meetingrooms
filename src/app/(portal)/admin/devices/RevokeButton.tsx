"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function RevokeButton({ deviceId, deviceLabel }: { deviceId: string; deviceLabel: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleRevoke() {
    setLoading(true);
    try {
      const res = await fetch(`/api/devices/${deviceId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Display revoked");
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(data?.error?.message ?? "Could not revoke this display");
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
          Revoke
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke this display?</AlertDialogTitle>
          <AlertDialogDescription>
            <strong>{deviceLabel}</strong> will be immediately disconnected and can no longer
            display room status or generate QR codes. You will need to re-pair it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleRevoke}
            disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading ? "Revoking…" : "Revoke"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
