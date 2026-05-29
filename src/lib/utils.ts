import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a UTC Date as HH:mm in Europe/London. */
export function localTime(date: Date | string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(typeof date === "string" ? new Date(date) : date);
}

/** Format a UTC Date as "1 Jun 2026" in Europe/London. */
export function localDate(date: Date | string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(typeof date === "string" ? new Date(date) : date);
}
