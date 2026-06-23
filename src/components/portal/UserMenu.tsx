"use client";

import { useState, useRef, useEffect } from "react";
import { UserAvatar } from "./UserAvatar";

interface Props {
  displayName: string;
}

export function UserMenu({ displayName }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="rounded-full ring-2 ring-secondary-fixed focus:outline-none focus-visible:ring-offset-1"
        aria-label="Account menu"
        aria-expanded={open}
      >
        <UserAvatar displayName={displayName} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-52 bg-white border border-surface-container-highest rounded-xl shadow-lg overflow-hidden z-50">
          <div className="px-4 py-3 text-sm font-medium text-on-surface truncate border-b border-surface-container-highest">
            {displayName}
          </div>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="w-full flex items-center gap-2 px-4 py-3 text-sm text-on-surface-variant hover:bg-surface-container transition-colors"
            >
              <span className="material-symbols-outlined text-base">logout</span>
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
