const SOON_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Computes the current status of a room given its bookings.
 * Works with both Date objects and ISO strings.
 */
export function computeRoomStatus(
  bookings: { startUtc: Date | string; endUtc: Date | string }[],
  now = new Date()
): "free" | "busy" | "soon" {
  const d = (v: Date | string) => (typeof v === "string" ? new Date(v) : v);
  const soon = new Date(now.getTime() + SOON_MS);

  if (bookings.some((b) => d(b.startUtc) <= now && d(b.endUtc) > now)) return "busy";
  if (bookings.some((b) => d(b.startUtc) > now && d(b.startUtc) <= soon)) return "soon";
  return "free";
}
