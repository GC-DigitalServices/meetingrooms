// Recorded-response fake for offline unit tests.
// Usage in a test file:
//   vi.mock("@/lib/graph/client");
//   import { recordResponse, clearRecordings } from "@/lib/graph/__mocks__/client";

import type { graphClient as RealClient } from "../client";

// Key format: "METHOD /path" — populated per-test with recordResponse().
const recordings = new Map<string, unknown>();

export function recordResponse(key: string, response: unknown): void {
  recordings.set(key, response);
}

export function clearRecordings(): void {
  recordings.clear();
}

function lookup<T>(key: string): Promise<T> {
  if (!recordings.has(key)) {
    return Promise.reject(new Error(`No recorded response for ${key}`));
  }
  return Promise.resolve(recordings.get(key) as T);
}

export const graphClient: typeof RealClient = {
  get: <T>(path: string) => lookup<T>(`GET ${path}`),
  getCalendar: <T>(path: string) => lookup<T>(`GET_CALENDAR ${path}`),
  post: <T>(path: string) => lookup<T>(`POST ${path}`),
  patch: <T>(path: string) => lookup<T>(`PATCH ${path}`),
  delete: (path: string) => lookup<void>(`DELETE ${path}`),
  getRawResponse: (path: string) => lookup<Response>(`RAW ${path}`),
};
