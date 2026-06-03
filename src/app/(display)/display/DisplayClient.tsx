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
// Booking state reducer — keyed by roomId
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
  /** Minutes until next booking starts (SOON only) */
  minsUntilBusy?: number;
  /** Formatted "until HH:MM" string (BUSY) or "from HH:MM" string (FREE/SOON) */
  timeLabel?: string;
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(new Date(iso));
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
    return {
      status: "BUSY",
      current,
      next: nextAfter,
      timeLabel: `Until ${formatTime(current.endUtc)}`,
    };
  }

  const upcoming = sorted.filter((b) => new Date(b.startUtc) > now);
  const next = upcoming[0];

  if (next) {
    const minsUntil = Math.round(
      (new Date(next.startUtc).getTime() - now.getTime()) / 60000,
    );
    if (minsUntil <= 15) {
      return {
        status: "SOON",
        next,
        minsUntilBusy: minsUntil,
        timeLabel: `From ${formatTime(next.startUtc)}`,
      };
    }
    return {
      status: "FREE",
      next,
      timeLabel: `Free until ${formatTime(next.startUtc)}`,
    };
  }

  return { status: "FREE", timeLabel: "Free all day" };
}

// ---------------------------------------------------------------------------
// QR image component
// ---------------------------------------------------------------------------

function QrImage({ url, size = 200 }: { url: string; size?: number }) {
  const src = `/api/qr?data=${encodeURIComponent(url)}`;
  return (
    <img
      src={src}
      alt="Scan to book"
      width={size}
      height={size}
      className="rounded-lg"
      style={{ imageRendering: "pixelated" }}
    />
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
}: {
  room: RoomInfo;
  statusInfo: StatusInfo;
  qrUrl: string | null;
  now: Date;
}) {
  const { status, current, next, minsUntilBusy, timeLabel } = statusInfo;

  const bgColor =
    status === "FREE"
      ? "var(--status-free)"
      : status === "SOON"
        ? "var(--status-soon)"
        : "var(--status-busy)";

  const subject =
    current?.visibility === "full" ? current.subject : current ? "Busy" : undefined;
  const organiser =
    current?.visibility === "full" ? current.organiserName : undefined;

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-between p-10 text-white transition-colors duration-200"
      style={{ backgroundColor: bgColor }}
    >
      {/* Top — room name */}
      <div className="text-center mt-8">
        <div className="text-7xl font-bold tracking-tight leading-tight">{room.displayName}</div>
        <div className="text-2xl mt-2 opacity-80">
          {room.capacity > 0 && `Capacity: ${room.capacity}`}
        </div>
      </div>

      {/* Middle — status info */}
      <div className="text-center space-y-3">
        {status === "BUSY" && (
          <>
            {subject && <div className="text-4xl font-semibold">{subject}</div>}
            {organiser && <div className="text-2xl opacity-90">{organiser}</div>}
            {timeLabel && <div className="text-3xl font-light">{timeLabel}</div>}
            {next && (
              <div className="text-xl opacity-70 mt-2">
                Next free: {formatTime(next.startUtc)}
              </div>
            )}
          </>
        )}
        {status === "SOON" && (
          <>
            <div className="text-5xl font-bold">
              {minsUntilBusy === 0 ? "Now" : `${minsUntilBusy} min${minsUntilBusy === 1 ? "" : "s"}`}
            </div>
            <div className="text-2xl opacity-90">until next booking</div>
            {next?.visibility === "full" && next.subject && (
              <div className="text-xl opacity-80">{next.subject}</div>
            )}
            {timeLabel && <div className="text-2xl font-light">{timeLabel}</div>}
          </>
        )}
        {status === "FREE" && (
          <div className="text-4xl font-light">{timeLabel}</div>
        )}
      </div>

      {/* Bottom — QR code */}
      <div className="flex flex-col items-center gap-4 mb-8">
        {qrUrl ? (
          <div className="bg-white p-4 rounded-2xl shadow-xl">
            <QrImage url={qrUrl} size={220} />
          </div>
        ) : (
          <div className="bg-white/20 rounded-2xl p-6 text-center">
            <div className="text-lg opacity-80">Scan QR to book</div>
          </div>
        )}
        <div className="text-lg opacity-75 font-light">Scan to book this room</div>
        {/* Fallback URL for users who can't scan */}
        {qrUrl && (
          <div className="text-sm opacity-50 font-mono">
            {new URL(qrUrl).pathname.split("?")[0]}
          </div>
        )}
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
  const bgColor =
    info.status === "FREE"
      ? "var(--status-free)"
      : info.status === "SOON"
        ? "var(--status-soon)"
        : "var(--status-busy)";

  const subject =
    info.current?.visibility === "full" ? info.current.subject : info.current ? "Busy" : undefined;

  return (
    <div
      className="flex-1 rounded-2xl p-6 text-white flex flex-col justify-between min-h-0 transition-colors duration-200"
      style={{ backgroundColor: bgColor }}
    >
      <div className="text-3xl font-bold">{section.displayName}</div>
      <div>
        {info.status === "BUSY" && (
          <>
            {subject && <div className="text-xl font-medium mt-2">{subject}</div>}
            {info.timeLabel && <div className="text-lg opacity-80 mt-1">{info.timeLabel}</div>}
          </>
        )}
        {info.status === "SOON" && (
          <div className="text-lg opacity-90 mt-2">
            Busy in {info.minsUntilBusy} min
          </div>
        )}
        {info.status === "FREE" && (
          <div className="text-lg opacity-80 mt-2">{info.timeLabel}</div>
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
}: {
  room: RoomInfo;
  bookingsMap: BookingsMap;
  qrUrl: string | null;
  now: Date;
}) {
  const sectionCount = room.sections.length;
  const gridClass =
    sectionCount === 2
      ? "flex flex-col gap-4"
      : sectionCount === 3
        ? "grid grid-cols-3 gap-4"
        : "grid grid-cols-2 gap-4"; // 4 sections

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col p-6 gap-5">
      {/* Header */}
      <div className="flex items-center justify-between px-2">
        <div className="text-4xl font-bold">{room.displayName}</div>
        <div className="flex flex-col items-end gap-2">
          {qrUrl ? (
            <div className="bg-white p-3 rounded-xl">
              <QrImage url={qrUrl} size={140} />
            </div>
          ) : (
            <div className="bg-white/10 rounded-xl p-4 text-center text-sm opacity-60">
              QR loading
            </div>
          )}
          <div className="text-sm opacity-60 text-right">Scan to book any section or the whole room</div>
        </div>
      </div>

      {/* Section cards */}
      <div className={`flex-1 ${gridClass} min-h-0`}>
        {room.sections.map((section) => (
          <SectionCard
            key={section.id}
            section={section}
            bookings={bookingsMap.get(section.id) ?? []}
            now={now}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Offline banner
// ---------------------------------------------------------------------------

function OfflineBanner({ status }: { status: ConnectionStatus }) {
  if (status === "live") return null;
  const msg =
    status === "offline"
      ? "Offline — showing last known state"
      : status === "connecting"
        ? "Reconnecting…"
        : null;
  if (!msg) return null;
  return (
    <div className="fixed bottom-4 right-4 bg-black/70 text-white text-sm px-4 py-2 rounded-full z-50">
      {msg}
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

  // ----------
  // 1-second clock
  // ----------
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ----------
  // Read token from localStorage
  // ----------
  useEffect(() => {
    const token = localStorage.getItem("device_token");
    setDeviceToken(token);
  }, []);

  // ----------
  // Fetch room info
  // ----------
  useEffect(() => {
    if (!deviceToken) return;

    fetch("/api/devices/me", {
      headers: { Authorization: `Bearer ${deviceToken}` },
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(body.error ?? "Failed to load device info");
        }
        return res.json() as Promise<{ device: DeviceInfo; room: RoomInfo }>;
      })
      .then(({ device, room }) => {
        setDeviceInfo(device);
        setRoomInfo(room);
      })
      .catch((err) => {
        setInitError(err instanceof Error ? err.message : "Unknown error");
      });
  }, [deviceToken]);

  // ----------
  // QR token fetcher — refresh every 90s
  // ----------
  const fetchQrToken = useCallback(() => {
    if (!deviceToken) return;

    fetch("/api/devices/qr-token", {
      headers: { Authorization: `Bearer ${deviceToken}` },
    })
      .then(async (res) => {
        if (!res.ok) return;
        return res.json() as Promise<{ token: string; expiresAt: string }>;
      })
      .then((data) => {
        if (!data) return;
        setQrToken(data.token);
        setQrExpiresAt(new Date(data.expiresAt));
      })
      .catch(() => {
        // Keep showing last QR until it expires
        if (qrExpiresAt && qrExpiresAt < new Date()) {
          setQrToken(null);
        }
      });

    qrTimerRef.current = setTimeout(fetchQrToken, 90_000);
  }, [deviceToken, qrExpiresAt]);

  useEffect(() => {
    if (!deviceToken || !roomInfo) return;
    fetchQrToken();
    return () => {
      if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
    };
  }, [deviceToken, roomInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----------
  // Socket.IO connection
  // ----------
  useEffect(() => {
    if (!deviceToken || !roomInfo) return;

    setConnectionStatus("connecting");

    const socket = io({ path: "/ws", auth: { token: deviceToken }, transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnectionStatus("live");
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }
    });

    socket.on("disconnect", () => {
      setConnectionStatus("connecting");
      offlineTimerRef.current = setTimeout(() => setConnectionStatus("offline"), 30_000);
    });

    socket.on("message", (msg: { type: string; payload: Record<string, unknown> }) => {
      const p = msg.payload;
      if (msg.type === "snapshot") {
        dispatch({
          type: "SNAPSHOT",
          roomId: p.roomId as string,
          bookings: p.bookings as BookingSlot[],
        });
        setConnectionStatus("live");
      } else if (msg.type === "booking.created") {
        dispatch({ type: "ADD", booking: p.booking as BookingSlot });
      } else if (msg.type === "booking.updated") {
        dispatch({ type: "UPDATE", booking: p.booking as BookingSlot });
      } else if (msg.type === "booking.deleted") {
        dispatch({
          type: "DELETE",
          roomId: p.roomId as string,
          bookingId: p.bookingId as string,
        });
      }
    });

    // Heartbeat — updates Device.lastSeenAt server-side
    heartbeatRef.current = setInterval(() => {
      socket.emit("message", { type: "heartbeat" });
    }, 60_000);

    return () => {
      socket.disconnect();
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
    };
  }, [deviceToken, roomInfo]);

  // ----------
  // Not paired
  // ----------
  if (!deviceToken) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center p-8">
        <div className="text-center space-y-4 max-w-sm">
          <div className="text-4xl">📱</div>
          <div className="text-2xl font-light">Display not paired</div>
          <div className="text-sm text-gray-400">
            Ask your administrator to generate a pairing code, then navigate to the enrolment URL on
            this device.
          </div>
        </div>
      </main>
    );
  }

  if (initError) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center p-8">
        <div className="text-center space-y-4 max-w-sm">
          <div className="text-red-400 text-xl">Display error</div>
          <div className="text-sm text-gray-300">{initError}</div>
          <div className="text-xs text-gray-500">
            The device token may have been revoked. Re-pair this display from the admin portal.
          </div>
        </div>
      </main>
    );
  }

  if (!roomInfo || !deviceInfo) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-gray-400 text-xl">Loading…</div>
      </main>
    );
  }

  // ----------
  // Build QR URL
  // ----------
  const baseUrl =
    typeof window !== "undefined" ? `${window.location.protocol}//${window.location.host}` : "";
  const qrUrl = qrToken
    ? `${baseUrl}/r/${roomInfo.id}?from=display&t=${encodeURIComponent(qrToken)}`
    : null;

  // QR expired?
  const qrValid = qrExpiresAt ? qrExpiresAt > now : false;
  const effectiveQrUrl = qrValid ? qrUrl : null;

  // ----------
  // Render layout
  // ----------
  const bookings = bookingsMap.get(roomInfo.id) ?? [];
  const statusInfo = computeStatus(bookings, now);

  return (
    <>
      {deviceInfo.scope === "COMPOSITE" ? (
        <CompositeLayout
          room={roomInfo}
          bookingsMap={bookingsMap}
          qrUrl={effectiveQrUrl}
          now={now}
        />
      ) : (
        <StandardLayout
          room={roomInfo}
          statusInfo={statusInfo}
          qrUrl={effectiveQrUrl}
          now={now}
        />
      )}
      <OfflineBanner status={connectionStatus} />
    </>
  );
}
