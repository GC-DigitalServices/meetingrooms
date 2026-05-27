import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node.js runtime only — no Edge runtime. Required for Socket.IO (phase 4),
  // Redis, and Prisma. Each route/layout that needs server-side features
  // should declare `export const runtime = "nodejs"` explicitly.
  serverExternalPackages: ["@prisma/client", "prisma", "ioredis", "@azure/msal-node", "pino", "pino-pretty"],
};

export default nextConfig;
