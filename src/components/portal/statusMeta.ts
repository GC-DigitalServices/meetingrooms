// Single source for how a room status renders as a pill/badge, shared by the
// room grid cards and the room-detail header so they can never disagree.
export const STATUS_META: Record<"free" | "busy" | "soon", { label: string; className: string }> = {
  free: { label: "Available", className: "bg-green-100 text-green-800" },
  busy: { label: "Busy", className: "bg-red-100 text-red-700" },
  soon: { label: "Soon", className: "bg-amber-100 text-amber-700" },
};
