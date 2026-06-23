"use client";

import { useEffect, useReducer, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BookingSlot {
  id: string;
  roomId: string;
  startUtc: string;
  endUtc: string;
  subject?: string;
  organiserName?: string;
  visibility: "full" | "busy";
}

interface SectionInfo {
  id: string;
  displayName: string;
  capacity: number;
}

interface RoomInfo {
  id: string;
  displayName: string;
  capacity: number;
  kind: string;
  sections: SectionInfo[];
}

interface DeviceInfo {
  id: string;
  scope: string;
  name: string | null;
}

type ConnectionStatus = "init" | "connecting" | "live" | "offline";

// ---------------------------------------------------------------------------
// Booking state reducer
// ---------------------------------------------------------------------------

type BookingsMap = Map<string, BookingSlot[]>;

type BookingsAction =
  | { type: "SNAPSHOT"; roomId: string; bookings: BookingSlot[] }
  | { type: "ADD"; booking: BookingSlot }
  | { type: "UPDATE"; booking: BookingSlot }
  | { type: "DELETE"; roomId: string; bookingId: string };

function bookingsReducer(state: BookingsMap, action: BookingsAction): BookingsMap {
  const next = new Map(state);
  switch (action.type) {
    case "SNAPSHOT":
      next.set(action.roomId, action.bookings);
      return next;
    case "ADD": {
      const prev = next.get(action.booking.roomId) ?? [];
      next.set(action.booking.roomId, [...prev, action.booking]);
      return next;
    }
    case "UPDATE": {
      const prev = next.get(action.booking.roomId) ?? [];
      next.set(
        action.booking.roomId,
        prev.map((b) => (b.id === action.booking.id ? action.booking : b)),
      );
      return next;
    }
    case "DELETE": {
      const prev = next.get(action.roomId) ?? [];
      next.set(
        action.roomId,
        prev.filter((b) => b.id !== action.bookingId),
      );
      return next;
    }
  }
}

// ---------------------------------------------------------------------------
// Status computation
// ---------------------------------------------------------------------------

export type RoomStatus = "FREE" | "SOON" | "BUSY";

export interface StatusInfo {
  status: RoomStatus;
  current?: BookingSlot;
  next?: BookingSlot;
  minsUntilBusy?: number;
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(new Date(iso));
}

function formatClock(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(date);
}

export function computeStatus(bookings: BookingSlot[], now: Date): StatusInfo {
  const sorted = [...bookings].sort(
    (a, b) => new Date(a.startUtc).getTime() - new Date(b.startUtc).getTime(),
  );

  const current = sorted.find(
    (b) => new Date(b.startUtc) <= now && new Date(b.endUtc) > now,
  );

  if (current) {
    const nextAfter = sorted.find((b) => new Date(b.startUtc) >= new Date(current.endUtc));
    return { status: "BUSY", current, next: nextAfter };
  }

  const upcoming = sorted.filter((b) => new Date(b.startUtc) > now);
  const next = upcoming[0];

  if (next) {
    const minsUntil = Math.round(
      (new Date(next.startUtc).getTime() - now.getTime()) / 60000,
    );
    if (minsUntil <= 15) {
      return { status: "SOON", next, minsUntilBusy: minsUntil };
    }
    return { status: "FREE", next };
  }

  return { status: "FREE" };
}

// ---------------------------------------------------------------------------
// Theme per status
// ---------------------------------------------------------------------------

const STATUS_THEME = {
  FREE: {
    bg: "#00534C",
    dot: "#4ade80",
    label: "Available",
    labelBg: "rgba(74,222,128,0.15)",
    labelText: "#4ade80",
  },
  BUSY: {
    bg: "#7f1d1d",
    dot: "#fca5a5",
    label: "In use",
    labelBg: "rgba(252,165,165,0.15)",
    labelText: "#fca5a5",
  },
  SOON: {
    bg: "#78350f",
    dot: "#fcd34d",
    label: "Starting soon",
    labelBg: "rgba(252,211,77,0.15)",
    labelText: "#fcd34d",
  },
} as const;

// ---------------------------------------------------------------------------
// Shared chrome components
// ---------------------------------------------------------------------------

const LOGO_URL = "https://www.greenhead.ac.uk/assets/images/global/logo.png";

function DisplayHeader({ time, connectionStatus }: { time: string; connectionStatus: ConnectionStatus }) {
  return (
    <div className="flex items-center justify-between px-10 pt-8 pb-6">
      {/* Logo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGO_URL} alt="Greenhead College" className="h-10 object-contain" />

      {/* Clock + status */}
      <div className="flex items-center gap-4">
        {connectionStatus !== "live" && connectionStatus !== "init" && (
          <div className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-sm text-white/60">
            <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
            {connectionStatus === "offline" ? "Offline" : "Reconnecting…"}
          </div>
        )}
        <div className="text-right font-mono text-5xl font-light tracking-tight text-white/90">
          {time}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: RoomStatus }) {
  const theme = STATUS_THEME[status];
  return (
    <div
      className="inline-flex items-center gap-2.5 rounded-full px-5 py-2 text-lg font-semibold"
      style={{ backgroundColor: theme.labelBg, color: theme.labelText }}
    >
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: theme.dot, boxShadow: `0 0 8px ${theme.dot}` }}
      />
      {theme.label}
    </div>
  );
}

function QrCard({ qrUrl, caption }: { qrUrl: string | null; caption: string }) {
  if (!qrUrl) return null;
  const imgSrc = `/api/qr?data=${encodeURIComponent(qrUrl)}`;
  // Strip the scheme (including non-standard microsoft-edge-https://) to get the path
  const displayPath = (() => {
    try {
      const normalized = qrUrl.replace(/^microsoft-edge-/, "");
      return new URL(normalized).pathname;
    } catch { return ""; }
  })();

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-2xl bg-white p-4 shadow-2xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imgSrc}
          alt="Scan to book"
          width={200}
          height={200}
          className="block"
          style={{ imageRendering: "pixelated" }}
        />
      </div>
      <p className="text-base font-medium text-white/80">{caption}</p>

      {/* Edge requirement notice */}
      <div className="mt-1 rounded-xl bg-white/10 px-5 py-3 text-center max-w-xs">
        <p className="text-sm font-medium text-white/90">
          📱 Requires <strong>Microsoft Edge</strong> on your device
        </p>
        <p className="mt-1 text-xs text-white/60">
          No Edge? Book from a college PC or laptop at
        </p>
        <p className="mt-0.5 font-mono text-xs font-semibold text-white/80">
          meetingrooms.greenhead.digital
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// STANDARD / SECTION layout
// ---------------------------------------------------------------------------

function StandardLayout({
  room,
  statusInfo,
  qrUrl,
  now,
  connectionStatus,
}: {
  room: RoomInfo;
  statusInfo: StatusInfo;
  qrUrl: string | null;
  now: Date;
  connectionStatus: ConnectionStatus;
}) {
  const { status, current, next, minsUntilBusy } = statusInfo;
  const theme = STATUS_THEME[status];

  const subject = current?.visibility === "full" ? current.subject : current ? "Busy" : undefined;
  const organiser = current?.visibility === "full" ? current.organiserName : undefined;

  return (
    <div
      className="flex min-h-screen flex-col text-white transition-colors duration-500"
      style={{ backgroundColor: theme.bg }}
    >
      <DisplayHeader time={formatClock(now)} connectionStatus={connectionStatus} />

      {/* Divider */}
      <div className="mx-10 h-px bg-white/10" />

      {/* Main content */}
      <div className="flex flex-1 flex-col items-center justify-between px-10 py-10">

        {/* Room name + status */}
        <div className="flex flex-col items-center gap-5 text-center">
          <StatusBadge status={status} />
          <h1 className="text-7xl font-bold leading-tight tracking-tight">
            {room.displayName}
          </h1>
          {room.capacity > 0 && (
            <p className="text-xl text-white/50">
              Capacity: {room.capacity}
            </p>
          )}
        </div>

        {/* Status details */}
        <div className="flex flex-col items-center gap-3 text-center">
          {status === "BUSY" && (
            <>
              {subject && (
                <p className="text-4xl font-semibold">{subject}</p>
              )}
              {organiser && (
                <p className="text-2xl text-white/70">{organiser}</p>
              )}
              {current && (
                <p className="text-2xl font-light text-white/80">
                  Until {formatTime(current.endUtc)}
                </p>
              )}
              {next && (
                <p className="mt-1 text-lg text-white/50">
                  Next free: {formatTime(current!.endUtc)}
                </p>
              )}
            </>
          )}

          {status === "SOON" && (
            <>
              <p className="text-5xl font-bold" style={{ color: theme.dot }}>
                {minsUntilBusy === 0 ? "Now" : `${minsUntilBusy} min${minsUntilBusy === 1 ? "" : "s"}`}
              </p>
              <p className="text-2xl text-white/70">until next booking</p>
              {next?.visibility === "full" && next.subject && (
                <p className="text-xl text-white/60">{next.subject}</p>
              )}
              {next && (
                <p className="text-xl font-light text-white/60">
                  From {formatTime(next.startUtc)}
                </p>
              )}
            </>
          )}

          {status === "FREE" && (
            <>
              {next ? (
                <p className="text-2xl font-light text-white/70">
                  Free until {formatTime(next.startUtc)}
                </p>
              ) : (
                <p className="text-2xl font-light text-white/70">Free all day</p>
              )}
            </>
          )}
        </div>

        {/* QR code */}
        <QrCard qrUrl={qrUrl} caption="Scan to book this room" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// COMPOSITE layout
// ---------------------------------------------------------------------------

function SectionCard({
  section,
  bookings,
  now,
}: {
  section: SectionInfo;
  bookings: BookingSlot[];
  now: Date;
}) {
  const info = computeStatus(bookings, now);
  const theme = STATUS_THEME[info.status];
  const subject =
    info.current?.visibility === "full" ? info.current.subject : info.current ? "Busy" : undefined;

  return (
    <div
      className="flex flex-1 flex-col justify-between rounded-2xl p-7 text-white transition-colors duration-500"
      style={{ backgroundColor: theme.bg }}
    >
      <div className="flex items-start justify-between">
        <h2 className="text-3xl font-bold">{section.displayName}</h2>
        <StatusBadge status={info.status} />
      </div>

      <div className="mt-4 space-y-1">
        {info.status === "BUSY" && (
          <>
            {subject && <p className="text-xl font-medium">{subject}</p>}
            {info.current && (
              <p className="text-lg text-white/70">Until {formatTime(info.current.endUtc)}</p>
            )}
          </>
        )}
        {info.status === "SOON" && (
          <p className="text-lg text-white/80">
            Busy in {info.minsUntilBusy} min
          </p>
        )}
        {info.status === "FREE" && (
          <p className="text-lg text-white/70">
            {info.next ? `Free until ${formatTime(info.next.startUtc)}` : "Free all day"}
          </p>
        )}
      </div>
    </div>
  );
}

function CompositeLayout({
  room,
  bookingsMap,
  qrUrl,
  now,
  connectionStatus,
}: {
  room: RoomInfo;
  bookingsMap: BookingsMap;
  qrUrl: string | null;
  now: Date;
  connectionStatus: ConnectionStatus;
}) {
  const sectionCount = room.sections.length;
  const gridClass =
    sectionCount <= 2 ? "flex flex-col gap-4" :
    sectionCount === 3 ? "grid grid-cols-3 gap-4" :
    "grid grid-cols-2 gap-4";

  return (
    <div
      className="flex min-h-screen flex-col text-white"
      style={{ backgroundColor: "#00534C" }}
    >
      <DisplayHeader time={formatClock(now)} connectionStatus={connectionStatus} />
      <div className="mx-10 h-px bg-white/10" />

      <div className="flex flex-1 gap-8 px-10 py-8">
        {/* Section cards */}
        <div className={`flex-1 ${gridClass}`}>
          {room.sections.map((section) => (
            <SectionCard
              key={section.id}
              section={section}
              bookings={bookingsMap.get(section.id) ?? []}
              now={now}
            />
          ))}
        </div>

        {/* Right panel — room name + QR */}
        <div className="flex w-72 flex-col items-center justify-between">
          <div className="text-center">
            <h1 className="text-4xl font-bold leading-tight">{room.displayName}</h1>
            <p className="mt-2 text-base text-white/50">Scan to book any section or the whole room</p>
          </div>
          <QrCard qrUrl={qrUrl} caption="Scan to book" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error / loading screens
// ---------------------------------------------------------------------------

function FullScreenMessage({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body?: string;
}) {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 p-10 text-white"
      style={{ backgroundColor: "#00534C" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGO_URL} alt="Greenhead College" className="mb-4 h-10 object-contain opacity-60" />
      <div className="text-5xl">{icon}</div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {body && <p className="max-w-sm text-center text-base text-white/60">{body}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main display client
// ---------------------------------------------------------------------------

export default function DisplayClient() {
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [bookingsMap, dispatch] = useReducer(bookingsReducer, new Map<string, BookingSlot[]>());
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrExpiresAt, setQrExpiresAt] = useState<Date | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("init");
  const [initError, setInitError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const socketRef = useRef<Socket | null>(null);
  const qrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1-second clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Read token from localStorage
  useEffect(() => {
    setDeviceToken(localStorage.getItem("device_token"));
  }, []);

  // Fetch room info
  useEffect(() => {
    if (!deviceToken) return;
    fetch("/api/devices/me", { headers: { Authorization: `Bearer ${deviceToken}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Failed");
        return res.json() as Promise<{ device: DeviceInfo; room: RoomInfo }>;
      })
      .then(({ device, room }) => { setDeviceInfo(device); setRoomInfo(room); })
      .catch((err) => setInitError(err instanceof Error ? err.message : "Unknown error"));
  }, [deviceToken]);

  // QR token fetcher — refresh every 90 s
  const fetchQrToken = useCallback(() => {
    if (!deviceToken) return;
    fetch("/api/devices/qr-token", { headers: { Authorization: `Bearer ${deviceToken}` } })
      .then(async (res) => { if (!res.ok) return; return res.json() as Promise<{ token: string; expiresAt: string }>; })
      .then((data) => { if (!data) return; setQrToken(data.token); setQrExpiresAt(new Date(data.expiresAt)); })
      .catch(() => { if (qrExpiresAt && qrExpiresAt < new Date()) setQrToken(null); });
    qrTimerRef.current = setTimeout(fetchQrToken, 90_000);
  }, [deviceToken, qrExpiresAt]);

  useEffect(() => {
    if (!deviceToken || !roomInfo) return;
    fetchQrToken();
    return () => { if (qrTimerRef.current) clearTimeout(qrTimerRef.current); };
  }, [deviceToken, roomInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch QR immediately when the screen wakes from sleep/backgrounding
  useEffect(() => {
    if (!deviceToken || !roomInfo) return;
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
        fetchQrToken();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [deviceToken, roomInfo, fetchQrToken]);

  // Socket.IO connection
  useEffect(() => {
    if (!deviceToken || !roomInfo) return;
    setConnectionStatus("connecting");

    const socket = io({ path: "/ws", auth: { token: deviceToken }, transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnectionStatus("live");
      if (offlineTimerRef.current) { clearTimeout(offlineTimerRef.current); offlineTimerRef.current = null; }
    });

    socket.on("disconnect", () => {
      setConnectionStatus("connecting");
      offlineTimerRef.current = setTimeout(() => setConnectionStatus("offline"), 30_000);
    });

    socket.on("message", (msg: { type: string; payload: Record<string, unknown> }) => {
      const p = msg.payload;
      if (msg.type === "snapshot") {
        dispatch({ type: "SNAPSHOT", roomId: p.roomId as string, bookings: p.bookings as BookingSlot[] });
        setConnectionStatus("live");
      } else if (msg.type === "booking.created") {
        dispatch({ type: "ADD", booking: p.booking as BookingSlot });
      } else if (msg.type === "booking.updated") {
        dispatch({ type: "UPDATE", booking: p.booking as BookingSlot });
      } else if (msg.type === "booking.deleted") {
        dispatch({ type: "DELETE", roomId: p.roomId as string, bookingId: p.bookingId as string });
      }
    });

    heartbeatRef.current = setInterval(() => socket.emit("message", { type: "heartbeat" }), 60_000);

    return () => {
      socket.disconnect();
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
    };
  }, [deviceToken, roomInfo]);

  // Not paired
  if (!deviceToken) {
    return (
      <FullScreenMessage
        icon="📱"
        title="Display not paired"
        body="Ask your administrator to generate a pairing code, then navigate to the enrolment URL on this device."
      />
    );
  }

  if (initError) {
    return (
      <FullScreenMessage
        icon="⚠️"
        title="Display error"
        body={`${initError} — The device token may have been revoked. Re-pair this display from the admin portal.`}
      />
    );
  }

  if (!roomInfo || !deviceInfo) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: "#00534C" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_URL} alt="Greenhead College" className="h-10 animate-pulse object-contain opacity-60" />
      </div>
    );
  }

  // Build QR URL — microsoft-edge-https:// scheme forces the link to open
  // directly in Edge when scanned. Requires Edge installed on the device.
  const host = typeof window !== "undefined" ? window.location.host : "";
  const qrValid = qrExpiresAt ? qrExpiresAt > now : false;
  const effectiveQrUrl = qrValid && qrToken
    ? `microsoft-edge-https://${host}/r/${roomInfo.id}?from=display&t=${encodeURIComponent(qrToken)}`
    : null;

  const bookings = bookingsMap.get(roomInfo.id) ?? [];
  const statusInfo = computeStatus(bookings, now);

  if (deviceInfo.scope === "COMPOSITE") {
    return (
      <CompositeLayout
        room={roomInfo}
        bookingsMap={bookingsMap}
        qrUrl={effectiveQrUrl}
        now={now}
        connectionStatus={connectionStatus}
      />
    );
  }

  return (
    <StandardLayout
      room={roomInfo}
      statusInfo={statusInfo}
      qrUrl={effectiveQrUrl}
      now={now}
      connectionStatus={connectionStatus}
    />
  );
}
