export type AssignmentMode = "single" | "perFile" | "random" | "roundRobin";

export type QueueStatus = "pending" | "queued" | "processing" | "completed" | "failed";

/** Job states reported by TTS.ai ("pending" means not yet submitted, so it is app-only). */
export type JobStatus = Exclude<QueueStatus, "pending">;

export interface Voice {
  /** Unique within the app. TTS.ai reuses voice IDs across models (e.g. "FR"), so this is "model:id". */
  key: string;
  /** Voice ID sent to the API. */
  id: string;
  name: string;
  /** Language code as reported by the API, e.g. "fr" or "fr-FR". Empty when unknown. */
  language: string;
  model?: string;
  gender?: string;
}

/** Speaker and speed that produced an item's current audio. */
export interface GenerationSnapshot {
  speaker: string;
  speed: number;
}

export interface QueueItem {
  id: string;
  text: string;
  filename: string;
  autoFilename: boolean;
  /** Per-file speed; only used when overrideSpeed is true. */
  speed: number;
  overrideSpeed: boolean;
  /** Voice key (see Voice.key). */
  speaker?: string;
  status: QueueStatus;
  jobId?: string;
  downloadUrl?: string;
  error?: string;
  generatedWith?: GenerationSnapshot;
}

/** Row fields a user can edit. */
export type QueueItemEdit = Partial<
  Pick<QueueItem, "text" | "filename" | "autoFilename" | "speed" | "overrideSpeed" | "speaker">
>;

/** Row fields written by the generation workflow. */
export type QueueItemProgress = Partial<
  Pick<QueueItem, "status" | "speaker" | "jobId" | "downloadUrl" | "error" | "generatedWith">
>;

export interface QueueItemUpdate {
  id: string;
  changes: QueueItemProgress;
}

export type QueueStats = Record<QueueStatus, number> & { total: number };

export interface SpeakerConfig {
  mode: AssignmentMode;
  singleSpeaker?: string;
  /** Voice keys: the pool for random mode, and the ordered rotation for round robin. */
  selectedVoices: string[];
}

/** One fully-resolved TTS request, ready to submit. */
export interface GenerationJob {
  itemId: string;
  text: string;
  voice: Voice;
  speed: number;
}
