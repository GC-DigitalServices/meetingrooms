"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

type ConnState = "connecting" | "connected" | "disconnected" | "degraded";

interface SocketCtx {
  socket: Socket | null;
  connState: ConnState;
}

const Ctx = createContext<SocketCtx>({ socket: null, connState: "connecting" });

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connState, setConnState] = useState<ConnState>("connecting");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let s: Socket;

    import("socket.io-client").then(({ io }) => {
      s = io("/", { path: "/ws", transports: ["websocket"] });

      const resetDegraded = () => {
        if (timer.current) clearTimeout(timer.current);
        setConnState("connected");
        // Mark degraded if we haven't received anything in 60 s
        timer.current = setTimeout(() => setConnState("degraded"), 60_000);
      };

      s.on("connect", resetDegraded);
      s.on("disconnect", () => {
        if (timer.current) clearTimeout(timer.current);
        setConnState("disconnected");
      });
      s.on("message", resetDegraded);

      setSocket(s);
    });

    return () => {
      s?.close();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return <Ctx.Provider value={{ socket, connState }}>{children}</Ctx.Provider>;
}

export const useSocket = () => useContext(Ctx);
