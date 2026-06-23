"use client";

import { useState } from "react";

interface Props {
  displayName: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function UserAvatar({ displayName }: Props) {
  const [photoFailed, setPhotoFailed] = useState(false);

  if (photoFailed) {
    return <InitialsAvatar displayName={displayName} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/api/me/photo"
      alt={displayName}
      className="h-8 w-8 rounded-full object-cover ring-2 ring-primary-container"
      onError={() => setPhotoFailed(true)}
    />
  );
}

function InitialsAvatar({ displayName }: { displayName: string }) {
  return (
    <div className="h-8 w-8 rounded-full bg-primary-container text-on-primary flex items-center justify-center text-xs font-bold select-none ring-2 ring-primary-container/50">
      {initials(displayName)}
    </div>
  );
}
