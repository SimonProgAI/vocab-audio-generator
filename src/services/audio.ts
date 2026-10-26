import { downloadAudio, toTtsApiError } from "./ttsApi";

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

/** WAV files start with "RIFF", four size bytes, then "WAVE". */
export async function isWav(audio: Blob): Promise<boolean> {
  const head = new Uint8Array(await audio.slice(0, 12).arrayBuffer());
  const text = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  return text(0, 4) === "RIFF" && text(8, 12) === "WAVE";
}

/**
 * Some models (piper, vits, bark-small) return WAV even though the app asks TTS.ai for MP3, so
 * WAV is converted here and every saved `.mp3` really is one. MP3 passes through untouched. The
 * encoder (LAME, LGPL-3.0) is loaded on first use, as its own file. If converting fails, the WAV
 * is kept rather than losing the audio.
 */
export async function toMp3(audio: Blob): Promise<Blob> {
  if (!(await isWav(audio))) return audio;
  try {
    const { wavToMp3 } = await import("./wavToMp3");
    return await wavToMp3(audio);
  } catch (error) {
    console.warn("Couldn't convert WAV audio to MP3, so it stays WAV.", error);
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
