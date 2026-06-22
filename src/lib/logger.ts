import pino from "pino";

// Redact secret-bearing fields anywhere they appear in a log object. Pino matches
// these paths (and the `*.` wildcard prefixes catch nested error/request objects),
// so a logged Graph error body, request headers, or token never reaches the sink.
const REDACT_PATHS = [
  "token",
  "accessToken",
  "access_token",
  "refresh_token",
  "clientState",
  "tokenHash",
  "password",
  "authorization",
  "cookie",
  "AZURE_CLIENT_SECRET",
  "SESSION_SECRET",
  "QR_SIGNING_KEY",
  "*.token",
  "*.accessToken",
  "*.authorization",
  "*.cookie",
  "*.headers.authorization",
  "*.headers.cookie",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  ...(process.env.NODE_ENV !== "production" && {
    transport: { target: "pino-pretty", options: { colorize: true } },
  }),
});
