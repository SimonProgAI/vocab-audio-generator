import { downloadAudio, toTtsApiError } from "./ttsApi";

/**
 * Finished audio files, kept in memory per URL so playing a row, downloading it and building the
 * ZIP fetch each file only once. Failed fetches aren't kept, so trying again refetches.
 */
const audioByUrl = new Map<string, Promise<Blob>>();

export function loadAudio(url: string): Promise<Blob> {
  const cached = audioByUrl.get(url);
  if (cached) return cached;
  const pending = downloadAudio(url);
  audioByUrl.set(url, pending);
  pending.catch(() => {
    if (audioByUrl.get(url) === pending) audioByUrl.delete(url);
  });
  return pending;
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
