import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory fake Redis covering the subset session.ts uses.
class FakeRedis {
  store = new Map<string, string>();
  sets = new Map<string, Set<string>>();

  async set(key: string, value: string) {
    this.store.set(key, value);
    return "OK";
  }
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async del(...keys: string[]) {
    let n = 0;
    for (const k of keys) {
      if (this.store.delete(k)) n++;
      if (this.sets.delete(k)) n++;
    }
    return n;
  }
  async sadd(key: string, member: string) {
    const s = this.sets.get(key) ?? new Set<string>();
    s.add(member);
    this.sets.set(key, s);
    return 1;
  }
  async srem(key: string, member: string) {
    return this.sets.get(key)?.delete(member) ? 1 : 0;
  }
  async smembers(key: string) {
    return [...(this.sets.get(key) ?? [])];
  }
  async expire() {
    return 1;
  }
}

const fake = new FakeRedis();
vi.mock("@/lib/realtime/redis", () => ({
  getRedisClient: () => fake,
}));

import {
  createSession,
  loadSession,
  deleteSession,
  revokeUserSessions,
} from "./session";

const base = {
  upn: "user@college.ac.uk",
  displayName: "Test User",
  groupIds: [],
  isStaff: false,
  isAdmin: false,
  termsAccepted: true,
  signedInAt: Date.now(),
};

beforeEach(() => {
  fake.store.clear();
  fake.sets.clear();
});

describe("session index + revocation", () => {
  it("indexes a created session under the user", async () => {
    const id = await createSession(base);
    const members = await fake.smembers("user:sessions:user@college.ac.uk");
    expect(members).toContain(id);
  });

  it("removes the session from the index on delete", async () => {
    const id = await createSession(base);
    await deleteSession(id);
    expect(await loadSession(id)).toBeNull();
    expect(await fake.smembers("user:sessions:user@college.ac.uk")).toHaveLength(0);
  });

  it("revokes every active session for a user at once", async () => {
    const a = await createSession(base);
    const b = await createSession(base);
    expect(await loadSession(a)).not.toBeNull();
    expect(await loadSession(b)).not.toBeNull();

    const count = await revokeUserSessions(base.upn);

    expect(count).toBe(2);
    expect(await loadSession(a)).toBeNull();
    expect(await loadSession(b)).toBeNull();
    expect(await fake.smembers("user:sessions:user@college.ac.uk")).toHaveLength(0);
  });

  it("indexes by lower-cased upn so revocation is case-insensitive", async () => {
    await createSession({ ...base, upn: "Mixed@College.AC.UK" });
    const count = await revokeUserSessions("mixed@college.ac.uk");
    expect(count).toBe(1);
  });

  it("revoking a user with no sessions is a no-op returning 0", async () => {
    expect(await revokeUserSessions("nobody@college.ac.uk")).toBe(0);
  });
});
