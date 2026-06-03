"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Room {
  id: string;
  displayName: string;
  building: string | null;
  kind: string;
}

interface PairResult {
  code: string;
  expiresAt: string;
  enrollUrl: string;
  roomName: string;
}

type Scope = "STANDARD" | "SECTION" | "COMPOSITE";

const SCOPE_LABELS: Record<Scope, string> = {
  STANDARD: "Standard room",
  SECTION: "One section (section door)",
  COMPOSITE: "Whole composite room (main entrance)",
};

export function PairDeviceDialog({ rooms }: { rooms: Room[] }) {
  const [open, setOpen] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [scope, setScope] = useState<Scope>("STANDARD");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PairResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedRoom = rooms.find((r) => r.id === roomId);

  // Determine which scopes are valid for the selected room
  const validScopes: Scope[] =
    !selectedRoom
      ? ["STANDARD"]
      : selectedRoom.kind === "COMPOSITE"
        ? ["SECTION", "COMPOSITE"]
        : ["STANDARD"];

  function handleRoomChange(id: string) {
    setRoomId(id);
    const room = rooms.find((r) => r.id === id);
    if (room?.kind === "COMPOSITE") setScope("COMPOSITE");
    else setScope("STANDARD");
    setResult(null);
    setError(null);
  }

  async function handleGenerate() {
    if (!roomId) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/devices/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, scope, name: name.trim() || undefined }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Failed to generate pairing code");
      }
      const data = (await res.json()) as PairResult;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setOpen(false);
    setRoomId("");
    setScope("STANDARD");
    setName("");
    setResult(null);
    setError(null);
  }

  const expiresIn = result
    ? Math.max(
        0,
        Math.round((new Date(result.expiresAt).getTime() - Date.now()) / 60000),
      )
    : 0;

  return (
    <>
      <Button onClick={() => setOpen(true)}>Pair display</Button>

      <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Pair a new display</DialogTitle>
            <DialogDescription>
              Generate a pairing code, then navigate to the enrolment URL on the iPad.
            </DialogDescription>
          </DialogHeader>

          {!result ? (
            <div className="space-y-4 pt-2">
              {/* Room picker */}
              <div className="space-y-1">
                <Label htmlFor="pair-room">Meeting room</Label>
                <select
                  id="pair-room"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={roomId}
                  onChange={(e) => handleRoomChange(e.target.value)}
                >
                  <option value="">Select a room…</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.displayName}
                      {r.building ? ` (${r.building})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Scope picker */}
              {selectedRoom && (
                <div className="space-y-1">
                  <Label>Display scope</Label>
                  <div className="space-y-2">
                    {validScopes.map((s) => (
                      <label key={s} className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="radio"
                          name="scope"
                          value={s}
                          checked={scope === s}
                          onChange={() => setScope(s)}
                          className="mt-0.5"
                        />
                        <span className="text-sm">{SCOPE_LABELS[s]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Optional name */}
              <div className="space-y-1">
                <Label htmlFor="pair-name">Device name (optional)</Label>
                <Input
                  id="pair-name"
                  placeholder="e.g. iPad outside Main Hall entrance"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button onClick={handleGenerate} disabled={!roomId || loading}>
                  {loading ? "Generating…" : "Generate pairing code"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              <div className="rounded-lg bg-muted p-4 space-y-3">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Pairing code</div>
                  <div className="text-5xl font-mono font-bold tracking-widest text-primary">
                    {result.code}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Expires in ~{expiresIn} minute{expiresIn !== 1 ? "s" : ""}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">Or navigate to this URL on the iPad</div>
                  <div className="text-sm font-mono break-all bg-background rounded px-2 py-1 border">
                    {result.enrollUrl}
                  </div>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                On the iPad, open Safari and go to the URL above (or have the admin type the 6-digit
                code if you&apos;ve set up a custom entry page). The display will pair and reload
                automatically.
              </p>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleClose}>
                  Done
                </Button>
                <Button onClick={handleGenerate} disabled={loading}>
                  {loading ? "Generating…" : "New code"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
