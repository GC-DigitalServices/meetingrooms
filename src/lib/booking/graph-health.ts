import { getRedisClient } from "@/lib/realtime/redis";

const KEY = "graph:degraded";
const TTL_SECS = 900; // 15 minutes — fail fast until Graph recovers

export async function isGraphDegraded(): Promise<boolean> {
  try {
    return !!(await getRedisClient().get(KEY));
  } catch {
    return false; // Redis unavailable — proceed optimistically
  }
}

export function markGraphDegraded(): void {
  getRedisClient().set(KEY, "1", "EX", TTL_SECS).catch(() => {});
}

export function clearGraphDegraded(): void {
  getRedisClient().del(KEY).catch(() => {});
}
