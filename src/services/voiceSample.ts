import type { Voice } from "../types/queue";
import { DEFAULT_SPEED } from "../utils/speed";
import { wait } from "../utils/wait";
import { loadAudio } from "./audio";
import { TtsApiError, getJobStatus, submitJob, type SubmittedJob } from "./ttsApi";

/** What every voice sample says. Short, so a sample costs few credits. */
export const SAMPLE_TEXT = "Bonjour, ça va ?";

const POLL_INTERVAL_MS = 1500;
/** About 3 minutes: some voices wait that long in TTS.ai's queue. */
const MAX_POLLS = 120;

/**
 * The voice list has no preview clips, so a sample is a real (short) TTS job. Each voice's sample is
 * made once and kept for the session. Asking again later is free once the first one has finished:
 * TTS.ai answers an identical request with the audio it already made (seen in the voice benchmark).
 */
const samples = new Map<string, Blob>();

/**
 * Sample jobs TTS.ai accepted that haven't finished yet, by voice key. Stopping a sample stops
 * checking on its job, not the job itself, so the next request for that voice checks on the same
 * job instead of paying for another one.
 */
const unfinishedJobs = new Map<string, string>();

export interface SampleOptions {
  /** Stops waiting (and checking on the job) when aborted. */
  signal?: AbortSignal;
  onSubmitted?: (job: SubmittedJob) => void;
}

export async function loadVoiceSample(voice: Voice, { signal, onSubmitted }: SampleOptions = {}): Promise<Blob> {
  const ready = samples.get(voice.key);
  if (ready) return ready;

  let jobId = unfinishedJobs.get(voice.key);
  if (!jobId) {
    const job = await submitJob({ text: SAMPLE_TEXT, voice, speed: DEFAULT_SPEED }, signal);
    onSubmitted?.(job);
    if (job.status === "failed") throw new TtsApiError("request", `TTS.ai couldn't make a sample of ${voice.name}.`);
    jobId = job.jobId;
    unfinishedJobs.set(voice.key, jobId);
  }

  for (let poll = 1; poll <= MAX_POLLS; poll += 1) {
    const result = await getJobStatus(jobId, signal);
    if (result.status === "completed") {
      unfinishedJobs.delete(voice.key);
      const audio = await loadAudio(result.resultUrl);
      samples.set(voice.key, audio);
      return audio;
    }
    if (result.status === "failed") {
      unfinishedJobs.delete(voice.key);
      throw new TtsApiError("request", result.error ?? `TTS.ai couldn't make a sample of ${voice.name}.`);
    }
    // Once stopped, the next status request rejects at once as aborted.
    await wait(POLL_INTERVAL_MS, signal);
  }
  throw new TtsApiError("request", `${voice.name} took too long to make a sample. Try again later.`);
}

export function clearVoiceSamples(): void {
  samples.clear();
  unfinishedJobs.clear();
}
