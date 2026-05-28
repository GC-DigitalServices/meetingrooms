export interface TimeRange {
  startUtc: Date;
  endUtc: Date;
}

/** True if two time ranges overlap (exclusive end boundaries). */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.startUtc < b.endUtc && a.endUtc > b.startUtc;
}

/**
 * Returns the first existing booking that conflicts with the proposed range,
 * or undefined if there are no conflicts.
 */
export function findConflict<T extends TimeRange>(
  proposed: TimeRange,
  existing: T[]
): T | undefined {
  return existing.find((e) => overlaps(proposed, e));
}
