import type { QueueStatus } from "../types/queue";

const STATUS_STYLES: Record<QueueStatus, { label: string; className: string; dot: string }> = {
  pending: { label: "Pending", className: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
  queued: { label: "Queued", className: "bg-amber-50 text-amber-700", dot: "bg-amber-500 animate-pulse" },
  processing: { label: "Processing", className: "bg-blue-50 text-blue-700", dot: "bg-blue-500 animate-pulse" },
  completed: { label: "Completed", className: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  failed: { label: "Failed", className: "bg-red-50 text-red-700", dot: "bg-red-500" },
};

export function StatusBadge({ status }: { status: QueueStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}
