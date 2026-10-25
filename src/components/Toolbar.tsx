import type { ReactNode } from "react";
import type { ZipProgress } from "../services/download";
import type { CreditUsage } from "../utils/credits";
import { Button } from "./Button";
import { CreditCounter } from "./CreditCounter";
import { Spinner } from "./Spinner";

interface ToolbarProps {
  isGenerating: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
  onStop: () => void;
  completedCount: number;
  zipProgress: ZipProgress | null;
  onDownloadAll: () => void;
  canClear: boolean;
  onClear: () => void;
  credits: CreditUsage;
  /** Messages shown above the buttons, so feedback stays next to the action that caused it. */
  children?: ReactNode;
}

export function Toolbar({
  isGenerating,
  canGenerate,
  onGenerate,
  onStop,
  completedCount,
  zipProgress,
  onDownloadAll,
  canClear,
  onClear,
  credits,
  children,
}: ToolbarProps) {
  return (
    <div className="sticky bottom-0 z-20 border-t border-slate-200 bg-white/95 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] backdrop-blur">
      <div className="mx-auto max-w-7xl space-y-3 px-6 py-3">
        {children && <div className="max-h-48 overflow-y-auto">{children}</div>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {isGenerating ? (
              <>
                <Button variant="danger" onClick={onStop}>
                  Stop
                </Button>
                <span className="flex items-center gap-2 text-sm text-slate-600">
                  <Spinner /> Generating audio…
                </span>
              </>
            ) : (
              <Button variant="primary" onClick={onGenerate} disabled={!canGenerate}>
                Generate All
              </Button>
            )}
            <CreditCounter usage={credits} />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={onDownloadAll} disabled={completedCount === 0 || zipProgress !== null}>
              {zipProgress ? (
                <>
                  <Spinner /> Preparing ZIP… {zipProgress.done}/{zipProgress.total}
                </>
              ) : (
                `Download All (ZIP)${completedCount > 0 ? ` · ${completedCount}` : ""}`
              )}
            </Button>
            <Button variant="danger" onClick={onClear} disabled={!canClear}>
              Clear Queue
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
