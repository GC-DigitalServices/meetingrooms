"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function RenewButton() {
  const [loading, setLoading] = useState(false);

  async function handleRenew() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/subscriptions/renew", { method: "POST" });
      const data = await res.json() as { renewed?: number; failed?: number; error?: { message?: string } };
      if (!res.ok) {
        toast.error(data.error?.message ?? "Renewal failed");
        return;
      }
      if (data.failed && data.failed > 0) {
        toast.warning(`${data.renewed} renewed, ${data.failed} failed — check app logs`);
      } else if (data.renewed === 0) {
        toast.info("No subscriptions needed renewal");
      } else {
        toast.success(`${data.renewed} subscription${data.renewed !== 1 ? "s" : ""} renewed`);
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleRenew} disabled={loading}>
      {loading ? "Renewing…" : "Renew now"}
    </Button>
  );
}
