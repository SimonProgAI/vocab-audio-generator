import { formatCredits, type CreditUsage } from "../utils/credits";

interface CreditCounterProps {
  usage: CreditUsage;
}

export function CreditCounter({ usage }: CreditCounterProps) {
  const { used, reportedRemaining } = usage;
  return (
    <p className="text-sm text-slate-600" aria-live="polite">
      <span className="font-medium tabular-nums text-slate-900">
        {formatCredits(used)} {used === 1 ? "credit" : "credits"}
      </span>{" "}
      used this session
      {reportedRemaining !== undefined && (
        <span title="TTS.ai's own figure. It doesn't always drop right after a job is charged.">
          {" · "}TTS.ai reports <span className="tabular-nums">{formatCredits(reportedRemaining)}</span> left
        </span>
      )}
    </p>
  );
}
