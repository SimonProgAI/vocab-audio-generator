import { downloadAudio, toTtsApiError } from "./ttsApi";
import { isWavHeader } from "./wavHeader";

/**
 * Finished audio files (converted to MP3 when TTS.ai sent WAV), kept in memory per URL so playing
 * a row, downloading it and building the ZIP fetch each file only once. Failed fetches aren't kept,
 * so trying again refetches.
 */
const audioByUrl = new Map<string, Promise<Blob>>();

export function loadAudio(url: string): Promise<Blob> {
  const cached = audioByUrl.get(url);
  if (cached) return cached;
  const pending = downloadAudio(url).then(toMp3);
  audioByUrl.set(url, pending);
  pending.catch(() => {
    if (audioByUrl.get(url) === pending) audioByUrl.delete(url);
  });
  return pending;
}

export async function isWav(audio: Blob): Promise<boolean> {
  return isWavHeader(new Uint8Array(await audio.slice(0, 12).arrayBuffer()));
}

// ---------------------------------------------------------------------------
// WAV → MP3, in a background worker so a big ZIP doesn't freeze the page
// ---------------------------------------------------------------------------

interface WorkerReply {
  id: number;
  mp3?: ArrayBuffer;
  error?: string;
}

/** undefined: not started yet; null: unavailable (no Worker, or it failed), so convert on the page. */
let worker: Worker | null | undefined;
let nextJob = 0;
const jobs = new Map<number, { resolve: (mp3: Blob) => void; reject: (error: Error) => void }>();

function conversionWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === "undefined" ? null : new Worker(new URL("./mp3Worker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
  }
  if (!worker) return null;
  worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
    const job = jobs.get(data.id);
    jobs.delete(data.id);
    if (data.mp3) job?.resolve(new Blob([data.mp3], { type: "audio/mpeg" }));
    else job?.reject(new Error(data.error ?? "The MP3 converter gave no result."));
  };
  // The worker couldn't load (old browser, blocked) or crashed: fail what's waiting, stop using it.
  worker.onerror = (event) => {
    event.preventDefault();
    for (const job of jobs.values()) job.reject(new Error(event.message || "The MP3 converter stopped."));
    jobs.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

async function convertInWorker(converter: Worker, wav: Blob): Promise<Blob> {
  const bytes = await wav.arrayBuffer();
  return new Promise((resolve, reject) => {
    const id = (nextJob += 1);
    jobs.set(id, { resolve, reject });
    converter.postMessage({ id, wav: bytes }, [bytes]);
  });
}

async function convertOnPage(wav: Blob): Promise<Blob> {
  const { wavToMp3 } = await import("./wavToMp3");
  return wavToMp3(wav);
}

/**
 * Some models (piper and vits; bark-small too, still listed for other languages) return WAV even
 * though the app asks TTS.ai for MP3, so WAV is converted here and every saved `.mp3` really is
 * one. MP3 passes through untouched. The encoder (LAME, LGPL-3.0) runs in its own worker file,
 * or on the page where workers aren't available. If anything fails, even checking the file's
 * type, the original audio is kept rather than lost.
 */
export async function toMp3(audio: Blob): Promise<Blob> {
  try {
    if (!(await isWav(audio))) return audio;
    const converter = conversionWorker();
    if (converter) {
      try {
        return await convertInWorker(converter, audio);
      } catch {
        // Fall through and try on the page.
      }
    }
    return await convertOnPage(audio);
  } catch (error) {
    console.warn("Couldn't convert WAV audio to MP3, so it stays as it is.", error);
    return audio;
  }
}

export function clearAudioCache(): void {
  audioByUrl.clear();
}

/** Forgets every file except the given ones, e.g. those still linked from a queue row. */
export function retainAudio(urls: ReadonlySet<string>): void {
  for (const url of audioByUrl.keys()) {
    if (!urls.has(url)) audioByUrl.delete(url);
  }
}

export const EXPIRED_AUDIO_MESSAGE =
  "This file's audio link has expired. Click Generate All to make it again.";

/**
 * TTS.ai doesn't say how long result links stay valid. A link that worked before and now answers
 * 404 or 410 (the file is gone) is treated as expired. A 403 isn't: it can be a temporary refusal,
 * and treating it as expired would throw away a working file and pay to make it again.
 */
export function isExpiredAudioError(error: unknown): boolean {
  const { status } = toTtsApiError(error);
  return status === 404 || status === 410;
}
