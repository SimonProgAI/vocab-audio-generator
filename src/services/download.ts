import JSZip from "jszip";
import type { QueueItem } from "../types/queue";
import { isExpiredAudioError, loadAudio } from "./audio";

export const ZIP_FILENAME = "vocabulary_audio.zip";
const ZIP_DOWNLOAD_CONCURRENCY = 4;

export interface ZipProgress {
  done: number;
  total: number;
}

export interface ZipResult {
  /** Files in the saved ZIP. When 0, nothing was saved. */
  added: number;
  /** Filenames that could not be fetched and were left out of the archive. */
  skipped: string[];
  /** Left-out rows whose audio link has expired, with the link that failed. */
  expired: Array<{ id: string; url: string }>;
}

type DownloadableItem = QueueItem & { downloadUrl: string };

export function isDownloadable(item: QueueItem): item is DownloadableItem {
  return item.status === "completed" && Boolean(item.downloadUrl);
}

export function toMp3Name(filename: string): string {
  const stem = filename.trim().replace(/\.mp3$/i, "").replace(/^\.+|\.+$/g, "");
  return `${stem || "audio"}.mp3`;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke later so the browser has time to start the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Appends _2, _3, … so duplicate filenames don't overwrite each other in the ZIP. */
function uniqueName(name: string, used: Set<string>): string {
  const stem = name.replace(/\.mp3$/, "");
  let candidate = name;
  for (let n = 2; used.has(candidate.toLowerCase()); n += 1) candidate = `${stem}_${n}.mp3`;
  used.add(candidate.toLowerCase());
  return candidate;
}

async function forEachWithConcurrency<T>(
  values: readonly T[],
  limit: number,
  task: (value: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < values.length) {
      const value = values[next];
      next += 1;
      if (value !== undefined) await task(value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
}

export async function downloadItem(item: QueueItem): Promise<void> {
  if (!isDownloadable(item)) throw new Error("This file isn't ready to download yet.");
  const blob = await loadAudio(item.downloadUrl);
  saveBlob(blob, toMp3Name(item.filename));
}

export async function downloadAllCompleted(
  items: readonly QueueItem[],
  onProgress?: (progress: ZipProgress) => void,
): Promise<ZipResult> {
  const used = new Set<string>();
  const entries = items
    .filter(isDownloadable)
    .map((item) => ({ item, name: uniqueName(toMp3Name(item.filename), used) }));
  if (entries.length === 0) throw new Error("There are no completed files to download yet.");

  const zip = new JSZip();
  const skipped: string[] = [];
  const expired: ZipResult["expired"] = [];
  let done = 0;
  onProgress?.({ done, total: entries.length });

  await forEachWithConcurrency(entries, ZIP_DOWNLOAD_CONCURRENCY, async ({ item, name }) => {
    try {
      zip.file(name, await loadAudio(item.downloadUrl));
    } catch (error) {
      skipped.push(name);
      if (isExpiredAudioError(error)) expired.push({ id: item.id, url: item.downloadUrl });
    } finally {
      done += 1;
      onProgress?.({ done, total: entries.length });
    }
  });

  if (skipped.length === entries.length) return { added: 0, skipped, expired };
  // MP3 is already compressed, so JSZip's default STORE mode is the right choice.
  saveBlob(await zip.generateAsync({ type: "blob" }), ZIP_FILENAME);
  return { added: entries.length - skipped.length, skipped, expired };
}
