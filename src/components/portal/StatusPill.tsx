import { cn } from "@/lib/utils";

interface Props {
  status: "free" | "busy" | "soon";
  className?: string;
}

const CONFIG = {
  free: { label: "Free", cls: "bg-status-free text-white" },
  busy: { label: "Busy", cls: "bg-status-busy text-white" },
  soon: { label: "Starting soon", cls: "bg-status-soon text-white" },
};

export default function StatusPill({ status, className }: Props) {
  const { label, cls } = CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        cls,
        className
      )}
    >
      {label}
    </span>
  );
}
