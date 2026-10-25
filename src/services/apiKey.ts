/**
 * The TTS.ai API key a visitor enters on the page. It stays in their browser and is only sent to
 * TTS.ai: for the current tab by default (sessionStorage), or on this device when they tick
 * "Remember" (localStorage). VITE_TTS_API_KEY still works for local development, but Vite compiles
 * it into the JavaScript, so a build anyone can open must not set it.
 */
export const API_KEY_STORAGE_KEY = "french-vocab-audio:api-key";

/** Used only when no key was entered on the page. */
export const BUILT_IN_API_KEY = (import.meta.env.VITE_TTS_API_KEY ?? "").trim();

export interface SavedApiKey {
  key: string;
  /** Kept on this device (localStorage) rather than only until the tab closes. */
  remembered: boolean;
}

type StorageKind = "localStorage" | "sessionStorage";

// When the browser blocks storage, the key still works until the page is closed.
let pageOnlyKey: SavedApiKey | undefined;

function read(kind: StorageKind): string | undefined {
  try {
    return window[kind].getItem(API_KEY_STORAGE_KEY)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function loadApiKey(): SavedApiKey | undefined {
  const remembered = read("localStorage");
  if (remembered) return { key: remembered, remembered: true };
  const forThisTab = read("sessionStorage");
  return forThisTab ? { key: forThisTab, remembered: false } : pageOnlyKey;
}

/** Keeps the key in one place only, so unticking "Remember" removes it from the device. */
export function saveApiKey(key: string, remember: boolean): void {
  forgetApiKey();
  const saved = { key: key.trim(), remembered: remember };
  if (!saved.key) return;
  try {
    window[remember ? "localStorage" : "sessionStorage"].setItem(API_KEY_STORAGE_KEY, saved.key);
  } catch {
    pageOnlyKey = saved;
  }
}

export function forgetApiKey(): void {
  pageOnlyKey = undefined;
  for (const kind of ["localStorage", "sessionStorage"] as const) {
    try {
      window[kind].removeItem(API_KEY_STORAGE_KEY);
    } catch {
      // Nothing stored there.
    }
  }
}

/** The key requests use: the visitor's own, else the built-in one (local development only). */
export function currentApiKey(): string {
  return loadApiKey()?.key ?? BUILT_IN_API_KEY;
}
