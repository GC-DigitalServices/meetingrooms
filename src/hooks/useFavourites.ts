"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "mrbs:fav";

function read(): Set<string> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

/**
 * Favourite room ids, persisted in localStorage. Loaded in an effect (not the
 * state initializer) so the first client render matches the server-rendered
 * HTML — favourites drive structural output (sections, chips), and reading
 * localStorage during hydration causes a React hydration mismatch.
 */
export function useFavourites(): {
  favourites: Set<string>;
  toggleFavourite: (roomId: string) => void;
} {
  const [favourites, setFavourites] = useState<Set<string>>(new Set());

  useEffect(() => {
    setFavourites(read());
  }, []);

  function toggleFavourite(roomId: string) {
    setFavourites((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return { favourites, toggleFavourite };
}
