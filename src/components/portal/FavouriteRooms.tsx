"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Props {
  /** All rooms the user can see, so favourite ids can be resolved to names */
  rooms: { id: string; displayName: string }[];
}

/**
 * Favourites live in localStorage (set via the star on room cards), so this
 * has to be a client component; renders nothing until mounted to avoid a
 * hydration mismatch, and nothing at all if there are no favourites.
 */
export default function FavouriteRooms({ rooms }: Props) {
  const [favIds, setFavIds] = useState<string[] | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("mrbs:fav");
      setFavIds(saved ? (JSON.parse(saved) as string[]) : []);
    } catch {
      setFavIds([]);
    }
  }, []);

  const favs = favIds ? rooms.filter((r) => favIds.includes(r.id)) : [];
  if (favs.length === 0) return null;

  return (
    <div className="mt-4">
      <h2 className="text-sm font-medium text-muted-foreground mb-2">Favourite rooms</h2>
      <div className="flex flex-wrap gap-1.5">
        {favs.map((r) => (
          <Link
            key={r.id}
            href={`/rooms/${r.id}`}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-full border border-outline-variant hover:border-primary text-on-surface transition-colors"
          >
            <span
              className="material-symbols-outlined text-sm filled text-secondary-fixed"
              aria-hidden="true"
            >
              star
            </span>
            {r.displayName}
          </Link>
        ))}
      </div>
    </div>
  );
}
