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
const samples = new Map<string, Promise<Blob>>();

export function loadVoiceSample(voice: Voice, onSubmitted?: (job: SubmittedJob) => void): Promise<Blob> {
  const cached = samples.get(voice.key);
  if (cached) return cached;
  const pending = makeSample(voice, onSubmitted);
  samples.set(voice.key, pending);
  pending.catch(() => {
    if (samples.get(voice.key) === pending) samples.delete(voice.key);
  });
  return pending;
}

export function clearVoiceSamples(): void {
  samples.clear();
}

async function makeSample(voice: Voice, onSubmitted?: (job: SubmittedJob) => void): Promise<Blob> {
  const job = await submitJob({ text: SAMPLE_TEXT, voice, speed: DEFAULT_SPEED });
  onSubmitted?.(job);
  if (job.status === "failed") throw new TtsApiError("request", `TTS.ai couldn't make a sample of ${voice.name}.`);

  for (let poll = 1; poll <= MAX_POLLS; poll += 1) {
    const result = await getJobStatus(job.jobId);
    if (result.status === "completed") return loadAudio(result.resultUrl);
    if (result.status === "failed") {
      throw new TtsApiError("request", result.error ?? `TTS.ai couldn't make a sample of ${voice.name}.`);
    }
    await wait(POLL_INTERVAL_MS);
  }
  throw new TtsApiError("request", `${voice.name} took too long to make a sample. Try again later.`);
}
