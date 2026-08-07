import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const redis = { set: vi.fn(), eval: vi.fn() };

vi.mock("./redis", () => ({ getRedisClient: () => redis }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { withLock } from "./lock";
import { LockTimeoutError } from "@/lib/booking/errors";

beforeEach(() => {
  redis.set.mockReset();
  redis.eval.mockReset();
  redis.eval.mockResolvedValue(1);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("withLock", () => {
  it("acquires with SET NX PX, runs fn, then releases", async () => {
    redis.set.mockResolvedValue("OK");

    const result = await withLock("lock:room:a", async () => "done");

    expect(result).toBe("done");
    expect(redis.set).toHaveBeenCalledWith(
      "lock:room:a",
      expect.any(String),
      "PX",
      expect.any(Number),
      "NX",
    );
    // release = eval of the token-guarded DEL script
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("DEL"),
      1,
      "lock:room:a",
      expect.any(String),
    );
  });

  it("releases the lock even if fn throws", async () => {
    redis.set.mockResolvedValue("OK");

    await expect(
      withLock("lock:room:a", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("DEL"),
      1,
      "lock:room:a",
      expect.any(String),
    );
  });

  it("throws LockTimeoutError when the lock never frees", async () => {
    vi.useFakeTimers();
    redis.set.mockResolvedValue(null); // always held by someone else

    const p = withLock("lock:room:a", async () => "never");
    const assertion = expect(p).rejects.toBeInstanceOf(LockTimeoutError);
    await vi.runAllTimersAsync();
    await assertion;
  });

  it("renews the lease while fn is still running", async () => {
    vi.useFakeTimers();
    redis.set.mockResolvedValue("OK");

    let finish!: () => void;
    const gate = new Promise<void>((r) => {
      finish = r;
    });

    const p = withLock("lock:room:a", () => gate);
    await vi.advanceTimersByTimeAsync(0); // let acquire resolve & the watchdog start
    await vi.advanceTimersByTimeAsync(5_000); // one renewal interval

    // renewal = eval of the token-guarded PEXPIRE script
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("PEXPIRE"),
      1,
      "lock:room:a",
      expect.any(String),
      expect.any(String),
    );

    finish();
    await p;
  });
});
