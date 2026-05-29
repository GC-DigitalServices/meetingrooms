"use client";

import { useSocket } from "@/lib/socket-context";

export default function ConnectionBanner() {
  const { connState } = useSocket();
  if (connState === "connected" || connState === "connecting") return null;

  return (
    <div className="bg-[#fff8e1] border-b border-[#ffe082] px-margin-mobile md:px-margin-desktop py-2 lg:ml-64">
      <div className="flex items-center gap-2 text-label-md font-label-md text-[#e65100]">
        <span className="material-symbols-outlined text-base">wifi_off</span>
        {connState === "disconnected"
          ? "Reconnecting — live updates paused"
          : "Connection degraded — updates may be delayed"}
      </div>
    </div>
  );
}
