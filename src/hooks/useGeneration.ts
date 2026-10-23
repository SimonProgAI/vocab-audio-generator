import { useCallback, useEffect, useRef, useState } from "react";
import { getJobStatus, submitJob, toTtsApiError, type TtsApiError } from "../services/ttsApi";
import type { GenerationJob, QueueItemProgress, QueueItemUpdate } from "../types/queue";
import { wait } from "../utils/wait";

const POLL_INTERVAL_MS = 1500;
const JOB_TIMEOUT_MS = 10 * 60 * 1000;
// Each poll already retries transient errors internally; this counts polls that still failed.
const MAX_CONSECUTIVE_POLL_FAILURES = 3;

export interface GenerationSummary {
  completed: number;
  failed: number;
  /** Jobs returned to "pending" because the run was stopped before they finished. */
  unfinished: number;
  stoppedByUser: boolean;
  /** Set when an error (e.g. an invalid API key) made it pointless to continue. */
  fatalError?: string;
}

interface ActiveJob {
  job: GenerationJob;
  jobId: string;
  status: "queued" | "processing";
  submittedAt: number;
  pollFailures: number;
}

/**
 * Runs a batch: submits every job, polls their status concurrently, and reports progress
 * through `applyProgress`. Submission and polling run side by side so early jobs finish
 * while later ones are still being submitted.
 */
export function useGeneration(applyProgress: (updates: QueueItemUpdate[]) => void) {
  const [isGenerating, setIsGenerating] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const stop = useCallback(() => controllerRef.current?.abort(), []);

  const run = useCallback(
    async (jobs: GenerationJob[]): Promise<GenerationSummary> => {
      const controller = new AbortController();
      controllerRef.current = controller;
      const { signal } = controller;
      setIsGenerating(true);

      const active = new Map<string, ActiveJob>();
      const finished = new Set<string>();
      let completed = 0;
      let failed = 0;
      let fatalError: string | undefined;
      let submitting = true;

      const update = (itemId: string, changes: QueueItemProgress) =>
        applyProgress([{ id: itemId, changes }]);

      const finish = (itemId: string, changes: QueueItemProgress) => {
        active.delete(itemId);
        finished.add(itemId);
        if (changes.status === "completed") completed += 1;
        else failed += 1;
        update(itemId, changes);
      };

      const fail = (itemId: string, error: string) => finish(itemId, { status: "failed", error });

      // An invalid API key would fail every remaining request, so end the whole run.
      const abortRun = (error: TtsApiError) => {
        fatalError = error.message;
        controller.abort();
      };

      const submitAll = async () => {
        for (const job of jobs) {
          if (signal.aborted) break;
          try {
            const result = await submitJob(job, signal);
            if (result.status === "failed") {
              fail(job.itemId, "TTS.ai rejected this job.");
              continue;
            }
            const status = result.status === "processing" ? "processing" : "queued";
            active.set(job.itemId, {
              job,
              jobId: result.jobId,
              status,
              submittedAt: Date.now(),
              pollFailures: 0,
            });
            update(job.itemId, { status, jobId: result.jobId });
          } catch (error) {
            const apiError = toTtsApiError(error);
            if (apiError.kind === "aborted") break;
            if (apiError.kind === "auth") {
              abortRun(apiError);
              break;
            }
            fail(job.itemId, apiError.message);
          }
        }
        submitting = false;
      };

      const poll = async (entry: ActiveJob) => {
        const { itemId } = entry.job;
        try {
          const result = await getJobStatus(entry.jobId, signal);
          entry.pollFailures = 0;
          switch (result.status) {
            case "completed":
              finish(itemId, {
                status: "completed",
                downloadUrl: result.resultUrl,
                generatedWith: { speaker: entry.job.voice.key, speed: entry.job.speed },
              });
              return;
            case "failed":
              fail(itemId, result.error ?? "TTS.ai couldn't generate this file.");
              return;
            default:
              if (Date.now() - entry.submittedAt > JOB_TIMEOUT_MS) {
                fail(itemId, "TTS.ai took too long to generate this file. Try again.");
              } else if (result.status !== entry.status) {
                entry.status = result.status;
                update(itemId, { status: result.status });
              }
          }
        } catch (error) {
          const apiError = toTtsApiError(error);
          if (apiError.kind === "aborted") return;
          if (apiError.kind === "auth") {
            abortRun(apiError);
            return;
          }
          entry.pollFailures += 1;
          if (entry.pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) fail(itemId, apiError.message);
        }
      };

      const pollUntilDone = async () => {
        while (!signal.aborted && (submitting || active.size > 0)) {
          for (const entry of [...active.values()]) {
            if (signal.aborted) return;
            await poll(entry);
          }
          await wait(POLL_INTERVAL_MS, signal);
        }
      };

      applyProgress(
        jobs.map((job) => ({
          id: job.itemId,
          changes: {
            status: "pending",
            speaker: job.voice.key,
            jobId: undefined,
            downloadUrl: undefined,
            error: undefined,
            generatedWith: undefined,
          },
        })),
      );

      try {
        await Promise.all([submitAll(), pollUntilDone()]);
      } finally {
        const unfinished = jobs.filter((job) => !finished.has(job.itemId));
        if (unfinished.length > 0) {
          applyProgress(
            unfinished.map((job) => ({ id: job.itemId, changes: { status: "pending", jobId: undefined } })),
          );
        }
        if (controllerRef.current === controller) controllerRef.current = null;
        setIsGenerating(false);
      }

      return {
        completed,
        failed,
        unfinished: jobs.length - completed - failed,
        stoppedByUser: signal.aborted && fatalError === undefined,
        fatalError,
      };
    },
    [applyProgress],
  );

  return { isGenerating, run, stop };
}
