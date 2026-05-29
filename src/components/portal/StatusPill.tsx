import { cn } from "@/lib/utils";

interface Props {
  status: "free" | "busy" | "soon";
  className?: string;
}

const CONFIG = {
  free: { label: "Available", cls: "bg-[#e8f5e9] text-[#1b5e20]" },
  busy: { label: "Occupied", cls: "bg-[#ffebee] text-[#b71c1c]" },
  soon: { label: "Starting soon", cls: "bg-[#fff8e1] text-[#e65100]" },
};

export default function StatusPill({ status, className }: Props) {
  const { label, cls } = CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-label-sm font-label-sm",
        cls,
        className
      )}
    >
      {label}
    </span>
  );
}
