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

export const EXPIRED_AUDIO_MESSAGE =
  "This file's audio link has expired. Click Generate All to make it again.";

/**
 * TTS.ai doesn't say how long result links stay valid. A link that worked before and now answers
 * 403, 404 or 410 is treated as expired.
 */
export function isExpiredAudioError(error: unknown): boolean {
  const { status } = toTtsApiError(error);
  return status === 403 || status === 404 || status === 410;
}
