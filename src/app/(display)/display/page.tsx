import DisplayClient from "./DisplayClient";

// The server component is a thin wrapper. All display logic lives in the
// client component (device token stored in localStorage, socket auth).
export const runtime = "nodejs";

export default function DisplayPage() {
  return <DisplayClient />;
}
