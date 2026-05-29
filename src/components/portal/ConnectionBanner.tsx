"use client";

import { WifiOff } from "lucide-react";
import { useSocket } from "@/lib/socket-context";

export default function ConnectionBanner() {
  const { connState } = useSocket();

  if (connState === "connected" || connState === "connecting") return null;

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
      <div className="container mx-auto flex items-center gap-2 text-sm text-amber-800 max-w-7xl">
        <WifiOff className="h-4 w-4 shrink-0" />
        {connState === "disconnected"
          ? "Reconnecting — live updates paused"
          : "Connection degraded — updates may be delayed"}
      </div>
    </div>
  );
}
