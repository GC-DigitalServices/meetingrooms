"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Users, Lock, Pencil, Trash2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Room {
  id: string;
  displayName: string;
  building: string | null;
  floor: string | null;
  capacity: number;
  kind: string;
  bookable: boolean;
  mailboxUpn: string | null;
  parentRoomId: string | null;
  allowedGroups: string[];
}

interface KnownGroup {
  id: string;
  label: string;
}

interface FormState {
  displayName: string;
  building: string;
  floor: string;
  capacity: string;
  kind: "STANDARD" | "MINIBUS" | "PARKING" | "PARKING_BAY";
  mailboxUpn: string;
  bookable: boolean;
  parentRoomId: string;
  checkedGroupIds: string[];
  extraGroupIds: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<string, string> = {
  STANDARD:    "Standard",
  COMPOSITE:   "Composite",
  SECTION:     "Section",
  MINIBUS:     "Minibus",
  PARKING:     "Car Park Pool",
  PARKING_BAY: "Car Park Bay",
};

const EDITABLE_KINDS = new Set(["STANDARD", "MINIBUS", "PARKING", "PARKING_BAY"]);

function blankForm(): FormState {
  return {
    displayName:    "",
    building:       "",
    floor:          "",
    capacity:       "1",
    kind:           "STANDARD",
    mailboxUpn:     "",
    bookable:       true,
    parentRoomId:   "",
    checkedGroupIds: [],
    extraGroupIds:  "",
  };
}

function roomToForm(room: Room, knownGroups: KnownGroup[]): FormState {
  const knownIds = new Set(knownGroups.map((g) => g.id));
  const checkedGroupIds = room.allowedGroups.filter((id) => knownIds.has(id));
  const extraGroupIds = room.allowedGroups.filter((id) => !knownIds.has(id)).join("\n");
  return {
    displayName:    room.displayName,
    building:       room.building ?? "",
    floor:          room.floor ?? "",
    capacity:       String(room.capacity),
    kind:           room.kind as FormState["kind"],
    mailboxUpn:     room.mailboxUpn ?? "",
    bookable:       room.bookable,
    parentRoomId:   room.parentRoomId ?? "",
    checkedGroupIds,
    extraGroupIds,
  };
}

function buildAllowedGroups(form: FormState): string[] {
  const extra = form.extraGroupIds
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...form.checkedGroupIds, ...extra])];
}

// ---------------------------------------------------------------------------
// RoomFormDialog
// ---------------------------------------------------------------------------

function RoomFormDialog({
  open,
  onClose,
  editRoom,
  knownGroups,
  parkingPools,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editRoom: Room | null;
  knownGroups: KnownGroup[];
  parkingPools: Room[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(blankForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = editRoom !== null;

  useEffect(() => {
    if (open) {
      setForm(editRoom ? roomToForm(editRoom, knownGroups) : blankForm());
      setError(null);
    }
  }, [open, editRoom, knownGroups]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleGroup(id: string) {
    setForm((f) => ({
      ...f,
      checkedGroupIds: f.checkedGroupIds.includes(id)
        ? f.checkedGroupIds.filter((g) => g !== id)
        : [...f.checkedGroupIds, id],
    }));
  }

  async function handleSubmit() {
    if (!form.displayName.trim()) { setError("Display name is required."); return; }
    const cap = parseInt(form.capacity, 10);
    if (isNaN(cap) || cap < 1) { setError("Capacity must be at least 1."); return; }

    setSubmitting(true);
    setError(null);

    const payload = {
      displayName:   form.displayName.trim(),
      building:      form.building.trim() || null,
      floor:         form.floor.trim() || null,
      capacity:      cap,
      mailboxUpn:    form.mailboxUpn.trim() || null,
      bookable:      form.bookable,
      allowedGroups: buildAllowedGroups(form),
      ...(!isEdit && { kind: form.kind }),
      ...(form.kind === "PARKING_BAY" && { parentRoomId: form.parentRoomId || null }),
    };

    const url    = isEdit ? `/api/admin/rooms/${editRoom!.id}` : "/api/admin/rooms";
    const method = isEdit ? "PATCH" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast.success(isEdit ? "Room updated" : "Room created");
        onSaved();
        onClose();
      } else {
        const data = (await res.json()) as { error?: { message?: string } };
        setError(data.error?.message ?? "Failed to save room.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${editRoom!.displayName}` : "Add room"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Display name */}
          <div className="space-y-1">
            <Label htmlFor="rf-name">Display name <span className="text-destructive">*</span></Label>
            <Input
              id="rf-name"
              value={form.displayName}
              onChange={(e) => setField("displayName", e.target.value)}
              placeholder="e.g. CT12"
              maxLength={100}
            />
          </div>

          {/* Building + Floor */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="rf-building">Building</Label>
              <Input
                id="rf-building"
                value={form.building}
                onChange={(e) => setField("building", e.target.value)}
                placeholder="e.g. Cooksey"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rf-floor">Floor</Label>
              <Input
                id="rf-floor"
                value={form.floor}
                onChange={(e) => setField("floor", e.target.value)}
                placeholder="e.g. Ground"
              />
            </div>
          </div>

          {/* Capacity */}
          <div className="space-y-1">
            <Label htmlFor="rf-capacity">Capacity <span className="text-destructive">*</span></Label>
            <Input
              id="rf-capacity"
              type="number"
              min={1}
              value={form.capacity}
              onChange={(e) => setField("capacity", e.target.value)}
              className="w-32"
            />
          </div>

          {/* Type — new rooms only */}
          {!isEdit && (
            <div className="space-y-1">
              <Label htmlFor="rf-kind">Type</Label>
              <select
                id="rf-kind"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.kind}
                onChange={(e) => setField("kind", e.target.value as FormState["kind"])}
              >
                <option value="STANDARD">Standard room</option>
                <option value="MINIBUS">Minibus</option>
                <option value="PARKING">Car Park Pool</option>
                <option value="PARKING_BAY">Car Park Bay</option>
              </select>
            </div>
          )}

          {/* Parent pool — PARKING_BAY only */}
          {form.kind === "PARKING_BAY" && (
            <div className="space-y-1">
              <Label htmlFor="rf-parent">Car Park Pool</Label>
              <select
                id="rf-parent"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.parentRoomId}
                onChange={(e) => setField("parentRoomId", e.target.value)}
              >
                <option value="">— select pool —</option>
                {parkingPools.map((p) => (
                  <option key={p.id} value={p.id}>{p.displayName}</option>
                ))}
              </select>
            </div>
          )}

          {/* Mailbox UPN */}
          <div className="space-y-1">
            <Label htmlFor="rf-mailbox">Mailbox UPN</Label>
            <Input
              id="rf-mailbox"
              type="email"
              value={form.mailboxUpn}
              onChange={(e) => setField("mailboxUpn", e.target.value)}
              placeholder="e.g. ct12@greenhead.ac.uk"
            />
            {isEdit && (
              <p className="text-xs text-muted-foreground">
                Changing this will delete the existing calendar subscription and create a new one.
              </p>
            )}
          </div>

          {/* Bookable */}
          <div className="flex items-center gap-2">
            <input
              id="rf-bookable"
              type="checkbox"
              checked={form.bookable}
              onChange={(e) => setField("bookable", e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="rf-bookable" className="cursor-pointer">Bookable</Label>
          </div>

          {/* Allowed groups */}
          <div className="space-y-2">
            <Label>Allowed groups</Label>
            <p className="text-xs text-muted-foreground">Leave all unchecked to allow any signed-in user.</p>
            {knownGroups.length > 0 && (
              <div className="space-y-2">
                {knownGroups.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.checkedGroupIds.includes(g.id)}
                      onChange={() => toggleGroup(g.id)}
                      className="h-4 w-4 rounded border-input"
                    />
                    <span className="text-sm">{g.label}</span>
                    <span className="text-xs text-muted-foreground font-mono">{g.id.slice(0, 8)}…</span>
                  </label>
                ))}
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="rf-extra-groups" className="text-xs text-muted-foreground">
                Additional group IDs (one per line)
              </Label>
              <textarea
                id="rf-extra-groups"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[60px] focus:outline-none focus:ring-2 focus:ring-ring"
                value={form.extraGroupIds}
                onChange={(e) => setField("extraGroupIds", e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Add room"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminRoomsPage() {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [knownGroups, setKnownGroups] = useState<KnownGroup[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRoom, setEditRoom] = useState<Room | null>(null);

  async function load() {
    const [roomsRes, groupsRes] = await Promise.all([
      fetch("/api/admin/rooms"),
      fetch("/api/admin/rooms/groups"),
    ]);
    if (roomsRes.ok) setRooms((await roomsRes.json()) as Room[]);
    if (groupsRes.ok) {
      const data = (await groupsRes.json()) as { knownGroups: KnownGroup[] };
      setKnownGroups(data.knownGroups);
    }
  }

  useEffect(() => { void load(); }, []);

  async function deleteRoom(room: Room) {
    if (!confirm(`Delete "${room.displayName}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/rooms/${room.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Room deleted");
      void load();
    } else {
      const data = (await res.json()) as { error?: { message?: string } };
      toast.error(data.error?.message ?? "Failed to delete room.");
    }
  }

  function openAdd() {
    setEditRoom(null);
    setDialogOpen(true);
  }

  function openEdit(room: Room) {
    setEditRoom(room);
    setDialogOpen(true);
  }

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-lg pb-lg">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Meeting Rooms</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {rooms === null ? "Loading…" : `${rooms.length} rooms configured`}
          </p>
        </div>
        <Button onClick={openAdd}>Add room</Button>
      </div>

      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Room</th>
              <th className="text-left px-4 py-3 font-medium">Building</th>
              <th className="text-left px-4 py-3 font-medium">Capacity</th>
              <th className="text-left px-4 py-3 font-medium">Type</th>
              <th className="text-left px-4 py-3 font-medium">Access</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {(rooms ?? []).map((room) => (
              <tr key={room.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium">{room.displayName}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {[room.building, room.floor].filter(Boolean).join(", ") || "—"}
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    {room.capacity}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className="text-xs">
                    {KIND_LABEL[room.kind] ?? room.kind}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {room.allowedGroups.length === 0 ? (
                    <span className="text-muted-foreground text-xs">All users</span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="h-3 w-3" />
                      {room.allowedGroups.length} group{room.allowedGroups.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={room.bookable ? "default" : "secondary"} className="text-xs">
                    {room.bookable ? "Bookable" : "Disabled"}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  {EDITABLE_KINDS.has(room.kind) ? (
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(room)}>
                        <Pencil className="h-3.5 w-3.5 mr-1" />
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => deleteRoom(room)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Read-only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <RoomFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        editRoom={editRoom}
        knownGroups={knownGroups}
        parkingPools={(rooms ?? []).filter((r) => r.kind === "PARKING")}
        onSaved={load}
      />
    </div>
  );
}
