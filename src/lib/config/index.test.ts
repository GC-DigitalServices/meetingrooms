import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_ENV = {
  NODE_ENV: "development",
  AZURE_TENANT_ID: "test-tenant-id",
  AZURE_CLIENT_ID: "test-client-id",
  AZURE_CLIENT_SECRET: "test-client-secret",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  SESSION_SECRET: "a".repeat(32),
  QR_SIGNING_KEY: "b".repeat(32),
  PUBLIC_BASE_URL: "http://localhost:3000",
};

describe("getConfig", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const [key, val] of Object.entries(VALID_ENV)) {
      vi.stubEnv(key, val);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns config when all vars are valid", async () => {
    const { getConfig } = await import("./index");
    const cfg = getConfig();
    expect(cfg.AZURE_TENANT_ID).toBe("test-tenant-id");
    expect(cfg.AZURE_CLIENT_ID).toBe("test-client-id");
    expect(cfg.NODE_ENV).toBe("development");
    expect(cfg.PORT).toBe(3000);
  });

  it("caches the result on repeated calls", async () => {
    const { getConfig } = await import("./index");
    const first = getConfig();
    const second = getConfig();
    expect(first).toBe(second);
  });

  it("throws a descriptive error when AZURE_TENANT_ID is empty", async () => {
    vi.stubEnv("AZURE_TENANT_ID", "");
    const { getConfig } = await import("./index");
    expect(() => getConfig()).toThrow("AZURE_TENANT_ID");
  });

  it("throws when DATABASE_URL is not a valid URL", async () => {
    vi.stubEnv("DATABASE_URL", "not-a-url");
    const { getConfig } = await import("./index");
    expect(() => getConfig()).toThrow("DATABASE_URL");
  });

  it("throws when REDIS_URL is not a valid URL", async () => {
    vi.stubEnv("REDIS_URL", "also-not-a-url");
    const { getConfig } = await import("./index");
    expect(() => getConfig()).toThrow("REDIS_URL");
  });

  it("throws when SESSION_SECRET is shorter than 32 characters", async () => {
    vi.stubEnv("SESSION_SECRET", "tooshort");
    const { getConfig } = await import("./index");
    expect(() => getConfig()).toThrow("SESSION_SECRET");
  });

  it("throws when QR_SIGNING_KEY is shorter than 32 characters", async () => {
    vi.stubEnv("QR_SIGNING_KEY", "tooshort");
    const { getConfig } = await import("./index");
    expect(() => getConfig()).toThrow("QR_SIGNING_KEY");
  });

  it("throws when PUBLIC_BASE_URL is not a valid URL", async () => {
    vi.stubEnv("PUBLIC_BASE_URL", "not-a-url");
    const { getConfig } = await import("./index");
    expect(() => getConfig()).toThrow("PUBLIC_BASE_URL");
  });

  it("coerces PORT string to number", async () => {
    vi.stubEnv("PORT", "8080");
    const { getConfig } = await import("./index");
    expect(getConfig().PORT).toBe(8080);
  });

  it("defaults PORT to 3000 when not set", async () => {
    vi.stubEnv("PORT", "");
    const { getConfig } = await import("./index");
    // Empty string coerces to NaN, zod falls back to default
    // PORT has .default(3000) so unset means 3000
    // Re-import without PORT stubbed
    vi.resetModules();
    vi.unstubAllEnvs();
    for (const [key, val] of Object.entries(VALID_ENV)) {
      vi.stubEnv(key, val);
    }
    const { getConfig: fresh } = await import("./index");
    expect(fresh().PORT).toBe(3000);
  });

  it("config proxy returns same values as getConfig()", async () => {
    const { config, getConfig } = await import("./index");
    expect(config.AZURE_TENANT_ID).toBe(getConfig().AZURE_TENANT_ID);
    expect(config.DATABASE_URL).toBe(getConfig().DATABASE_URL);
  });

  it("config proxy throws on invalid config", async () => {
    vi.stubEnv("SESSION_SECRET", "short");
    const { config } = await import("./index");
    expect(() => config.SESSION_SECRET).toThrow("SESSION_SECRET");
  });

  it("error message lists all failing fields at once", async () => {
    vi.stubEnv("SESSION_SECRET", "short");
    vi.stubEnv("QR_SIGNING_KEY", "short");
    const { getConfig } = await import("./index");
    expect(() => getConfig()).toThrow(/SESSION_SECRET.*QR_SIGNING_KEY|QR_SIGNING_KEY.*SESSION_SECRET/s);
  });
});
