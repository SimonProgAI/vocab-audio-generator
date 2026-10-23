import type { QueueStats } from "../types/queue";
import { Section } from "./Section";

interface ProgressPanelProps {
  stats: QueueStats;
}

export function ProgressPanel({ stats }: ProgressPanelProps) {
  const { total, completed, failed } = stats;
  const percent = (count: number) => (total === 0 ? 0 : (count / total) * 100);

  const tiles = [
    { label: "Total Files", value: total, tone: "text-slate-900" },
    { label: "Pending", value: stats.pending, tone: "text-slate-600" },
    {
      label: "Processing",
      value: stats.queued + stats.processing,
      tone: "text-blue-700",
      hint: stats.queued > 0 ? `${stats.queued} waiting in TTS.ai's queue` : undefined,
    },
    { label: "Completed", value: completed, tone: "text-emerald-700" },
    { label: "Failed", value: failed, tone: "text-red-700" },
  ];

  return (
    <Section step={4} title="Progress">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{tile.label}</dt>
            <dd className={`mt-1 text-2xl font-semibold tabular-nums ${tile.tone}`}>{tile.value}</dd>
            {tile.hint && <dd className="text-xs text-slate-500">{tile.hint}</dd>}
          </div>
        ))}
      </dl>

      <div className="mt-5">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium text-slate-700">
            {completed} / {total} Complete
          </span>
          <span className="tabular-nums text-slate-500">{Math.round(percent(completed))}%</span>
        </div>
        <div
          role="progressbar"
          aria-label="Overall progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={completed}
          className="mt-2 flex h-3 overflow-hidden rounded-full bg-slate-100"
        >
          <div
            className="bg-emerald-500 transition-[width] duration-500"
            style={{ width: `${percent(completed)}%` }}
          />
          <div className="bg-red-400 transition-[width] duration-500" style={{ width: `${percent(failed)}%` }} />
        </div>
        {failed > 0 && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-red-400" />
            Red shows failed files.
          </p>
        )}
      </div>
    </Section>
  );
}
