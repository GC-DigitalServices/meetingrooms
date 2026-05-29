import { z } from "zod";

// ---------------------------------------------------------------------------
// Environment schema
// All required vars are validated at first call. Missing or malformed config
// throws a descriptive error that surfaces immediately on boot.
// ---------------------------------------------------------------------------

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Microsoft Entra ID — app registration credentials
  AZURE_TENANT_ID: z.string().min(1, "AZURE_TENANT_ID is required"),
  AZURE_CLIENT_ID: z.string().min(1, "AZURE_CLIENT_ID is required"),
  AZURE_CLIENT_SECRET: z.string().min(1, "AZURE_CLIENT_SECRET is required"),

  // Postgres — injected by Railway in production, set in .env.local for dev
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),

  // Redis — injected by Railway in production, set in .env.local for dev
  REDIS_URL: z.string().url("REDIS_URL must be a valid URL"),

  // Session cookie signing — min 32 chars
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),

  // QR token HMAC signing — min 32 chars
  QR_SIGNING_KEY: z
    .string()
    .min(32, "QR_SIGNING_KEY must be at least 32 characters"),

  // Canonical public URL — used for OAuth redirects, QR deep links, webhook URLs
  PUBLIC_BASE_URL: z.string().url("PUBLIC_BASE_URL must be a valid URL"),

  PORT: z.coerce.number().default(3000),

  // Optional — mailbox used as the From address for premises/transport notifications.
  MAIL_SENDER_UPN: z.string().email().optional(),
});

export type Config = z.infer<typeof EnvSchema>;

let _config: Config | undefined;

/**
 * Returns the validated config singleton. Throws on first call if any
 * required variable is missing or malformed. This is the intended behaviour —
 * misconfigured deploys should fail loudly rather than silently misfunction.
 */
export function getConfig(): Config {
  if (_config) return _config;

  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  _config = result.data;
  return _config;
}

// Convenience re-export for callers who just want the object directly.
// Accessing any property triggers validation on first use.
export const config = new Proxy({} as Config, {
  get(_target, key: string) {
    return getConfig()[key as keyof Config];
  },
});
