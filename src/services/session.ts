import type { AssignmentMode, GenerationSnapshot, QueueItem, QueueStatus, SpeakerConfig } from "../types/queue";
import type { CreditUsage } from "../utils/credits";
import { MAX_SPEED, MIN_SPEED } from "../utils/speed";
import { DEFAULT_VOICE_LIST, type VoiceListOptions } from "../utils/voices";

/**
 * The queue, the Bulk Import text and the settings are kept in sessionStorage, so a refresh or an
 * accidental back navigation doesn't lose a long word list, whether or not it was added to the queue yet. sessionStorage belongs to the browser tab and is cleared when the
 * tab closes. Bump the version in the key when the saved shape changes; older data is then ignored.
 */
export const SESSION_KEY = "french-vocab-audio:session:v1";

export interface SessionSettings {
  config: SpeakerConfig;
  globalSpeed: number;
  /** null means "use the default language". */
  languageChoice: string | null;
  voiceList: VoiceListOptions;
}

export interface SessionSnapshot {
  items: QueueItem[];
  /** Text in the Bulk Import box that hasn't been added to the queue yet. */
  draft: string;
  settings: SessionSettings;
  credits: CreditUsage;
}

export interface RestoredSession {
  items: QueueItem[];
  /** Empty when nothing (valid) was saved. */
  draft: string;
  /** Only the settings that were saved and valid; the app uses its defaults for the rest. */
  settings: Partial<SessionSettings>;
  /** Rows that were still generating when the page went away; the app checks on their jobs again. */
  interrupted: number;
  /** Undefined when nothing valid was saved. */
  credits?: CreditUsage;
}

// ---------------------------------------------------------------------------
// Storage (sessionStorage can be missing, blocked, or full: persistence is best-effort)
// ---------------------------------------------------------------------------

function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function loadSession(): RestoredSession | undefined {
  try {
    const raw = storage()?.getItem(SESSION_KEY);
    return raw ? parseSession(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}

export function saveSession(session: SessionSnapshot): void {
  try {
    storage()?.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Full or blocked: the app keeps working, it just won't survive a reload. Drop the previous copy
    // so a reload doesn't bring back an out-of-date queue.
    clearSession();
  }
}

export function clearSession(): void {
  try {
    storage()?.removeItem(SESSION_KEY);
  } catch {
    // Nothing to clear.
  }
}

// ---------------------------------------------------------------------------
// Parsing (saved data may be corrupted or from an older version, so every field is checked)
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

const STATUSES: ReadonlySet<string> = new Set<QueueStatus>(["pending", "queued", "processing", "completed", "failed"]);
const MODES: ReadonlySet<string> = new Set<AssignmentMode>(["single", "perFile", "random", "roundRobin"]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is QueueStatus {
  return typeof value === "string" && STATUSES.has(value);
}

function isMode(value: unknown): value is AssignmentMode {
  return typeof value === "string" && MODES.has(value);
}

function isSpeed(value: unknown): value is number {
  return typeof value === "number" && value >= MIN_SPEED && value <= MAX_SPEED;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseSnapshot(value: unknown): GenerationSnapshot | undefined {
  if (!isRecord(value) || typeof value.speaker !== "string" || !isSpeed(value.speed)) return undefined;
  return { speaker: value.speaker, speed: value.speed };
}

function parseItem(value: unknown): QueueItem | undefined {
  if (!isRecord(value)) return undefined;
  const { id, text, filename, autoFilename, speed, overrideSpeed, status } = value;
  if (
    typeof id !== "string" ||
    id === "" ||
    typeof text !== "string" ||
    typeof filename !== "string" ||
    typeof autoFilename !== "boolean" ||
    !isSpeed(speed) ||
    typeof overrideSpeed !== "boolean" ||
    !isStatus(status)
  ) {
    return undefined;
  }
  return {
    id,
    text,
    filename,
    autoFilename,
    speed,
    overrideSpeed,
    status,
    speaker: optionalString(value.speaker),
    jobId: optionalString(value.jobId),
    downloadUrl: optionalString(value.downloadUrl),
    error: optionalString(value.error),
    generatedWith: parseSnapshot(value.generatedWith),
  };
}

function parseConfig(value: unknown): SpeakerConfig | undefined {
  if (!isRecord(value) || !isMode(value.mode)) return undefined;
  const selected = Array.isArray(value.selectedVoices) ? value.selectedVoices : [];
  return {
    mode: value.mode,
    singleSpeaker: optionalString(value.singleSpeaker),
    selectedVoices: selected.filter((key): key is string => typeof key === "string"),
  };
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseCredits(value: unknown): CreditUsage | undefined {
  if (!isRecord(value) || !isCount(value.used)) return undefined;
  return { used: value.used, reportedRemaining: isCount(value.reportedRemaining) ? value.reportedRemaining : undefined };
}

/** Before the checkboxes, a "Sort voices" dropdown saved one of these. */
const OLD_VOICE_ORDERS: Readonly<Record<string, Partial<VoiceListOptions>>> = {
  name: {},
  tier: { byPrice: true },
  followsSpeed: { byPrice: true, followsSpeed: true },
};

function parseVoiceList(value: unknown, oldOrder: unknown): VoiceListOptions | undefined {
  if (isRecord(value)) {
    const options = { ...DEFAULT_VOICE_LIST };
    for (const key of Object.keys(DEFAULT_VOICE_LIST) as Array<keyof VoiceListOptions>) {
      const saved = value[key];
      if (typeof saved === "boolean") options[key] = saved;
    }
    return options;
  }
  const old = typeof oldOrder === "string" ? OLD_VOICE_ORDERS[oldOrder] : undefined;
  return old ? { ...DEFAULT_VOICE_LIST, testedOnly: false, ...old } : undefined;
}

function parseSettings(value: unknown): Partial<SessionSettings> {
  if (!isRecord(value)) return {};
  const settings: Partial<SessionSettings> = {};
  const config = parseConfig(value.config);
  if (config) settings.config = config;
  if (isSpeed(value.globalSpeed)) settings.globalSpeed = value.globalSpeed;
  if (value.languageChoice === null || typeof value.languageChoice === "string") {
    settings.languageChoice = value.languageChoice;
  }
  const voiceList = parseVoiceList(value.voiceList, value.voiceOrder);
  if (voiceList) settings.voiceList = voiceList;
  return settings;
}

function isGenerating(item: QueueItem): boolean {
  return item.status === "queued" || item.status === "processing";
}

/**
 * Rows that were queued or processing keep their job ID, so the app can check on the same TTS.ai
 * job again instead of submitting (and paying for) a new one while the old one may still be
 * running. A row without a job ID or speaker can't be picked up and starts over as Pending.
 */
function restoreInterrupted(item: QueueItem): QueueItem {
  return isGenerating(item) && (!item.jobId || !item.speaker)
    ? { ...item, status: "pending", jobId: undefined }
    : item;
}

/** Invalid rows are dropped and invalid settings are left out, rather than losing everything. */
export function parseSession(data: unknown): RestoredSession | undefined {
  if (!isRecord(data) || !Array.isArray(data.items)) return undefined;
  const ids = new Set<string>();
  const items: QueueItem[] = [];
  let interrupted = 0;
  for (const value of data.items) {
    const item = parseItem(value);
    if (!item || ids.has(item.id)) continue;
    ids.add(item.id);
    const restored = restoreInterrupted(item);
    if (isGenerating(restored)) interrupted += 1;
    items.push(restored);
  }
  const draft = typeof data.draft === "string" ? data.draft : "";
  return { items, draft, settings: parseSettings(data.settings), interrupted, credits: parseCredits(data.credits) };
}
