#!/usr/bin/env tsx
/**
 * ws-harness — connect to the Socket.IO server as a portal or device client
 * and dump messages to stdout.
 *
 * Usage:
 *   tsx scripts/ws-harness.ts portal  <baseUrl> <sessionCookie> [roomId ...]
 *   tsx scripts/ws-harness.ts device  <baseUrl> <deviceToken>
 *
 * Examples:
 *   tsx scripts/ws-harness.ts portal http://localhost:3000 abc123 room_id_1 room_id_2
 *   tsx scripts/ws-harness.ts device http://localhost:3000 my-device-token
 */
import { io, type Socket } from "socket.io-client";

const [, , mode = "portal", baseUrl = "http://localhost:3000", credential = "", ...extraArgs] =
  process.argv;

if (!["portal", "device"].includes(mode)) {
  console.error("Usage: tsx scripts/ws-harness.ts [portal|device] <baseUrl> <credential> [roomIds...]");
  process.exit(1);
}

const socket: Socket = io(baseUrl, {
  path: "/ws",
  transports: ["websocket"],
  ...(mode === "device"
    ? { auth: { token: credential } }
    : { extraHeaders: { cookie: `session=${credential}` } }),
});

socket.on("connect", () => {
  log(`connected — id=${socket.id}`);

  if (mode === "portal" && extraArgs.length > 0) {
    log(`subscribing to rooms: ${extraArgs.join(", ")}`);
    socket.emit("message", { type: "subscribe", roomIds: extraArgs });
  }
});

socket.on("message", (msg: unknown) => {
  const m = msg as { type?: string; id?: string; at?: string };
  if (m?.type === "ping") {
    process.stdout.write(".");
    return;
  }
  log(`message: ${JSON.stringify(msg, null, 2)}`);
});

socket.on("connect_error", (err: Error) => {
  log(`connect_error: ${err.message}`);
});

socket.on("disconnect", (reason: string) => {
  log(`disconnected: ${reason}`);
});

process.on("SIGINT", () => {
  socket.close();
  process.exit(0);
});

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}
