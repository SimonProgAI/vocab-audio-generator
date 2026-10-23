import type { GenerationJob, QueueItem, SpeakerConfig, Voice } from "../types/queue";
import { effectiveSpeed } from "../utils/speed";

export type RandomSource = () => number;

/** The speaker a row will get, when it can be known before generation (every mode except random). */
export function previewSpeaker(
  item: QueueItem,
  index: number,
  config: SpeakerConfig,
): string | undefined {
  switch (config.mode) {
    case "single":
      return config.singleSpeaker;
    case "perFile":
      return item.speaker;
    case "roundRobin":
      return config.selectedVoices.length > 0
        ? config.selectedVoices[index % config.selectedVoices.length]
        : undefined;
    case "random":
      return undefined;
  }
}

export function resolveSpeaker(
  item: QueueItem,
  index: number,
  config: SpeakerConfig,
  random: RandomSource = Math.random,
): string | undefined {
  if (config.mode !== "random") return previewSpeaker(item, index, config);
  return config.selectedVoices[Math.floor(random() * config.selectedVoices.length)];
}

/** True when a completed row's audio still matches the current speaker and speed settings. */
export function isUpToDate(
  item: QueueItem,
  index: number,
  config: SpeakerConfig,
  globalSpeed: number,
): boolean {
  const generated = item.generatedWith;
  if (item.status !== "completed" || !generated) return false;
  if (generated.speed !== effectiveSpeed(item, globalSpeed)) return false;
  return config.mode === "random"
    ? config.selectedVoices.includes(generated.speaker)
    : generated.speaker === previewSpeaker(item, index, config);
}

export type GenerationPlan = { ok: true; jobs: GenerationJob[] } | { ok: false; errors: string[] };

const MAX_LISTED_ROWS = 8;

/** rows are 1-based row numbers. */
function describeRows(rows: number[], problem: string, fix: string): string {
  const listed = rows.slice(0, MAX_LISTED_ROWS).join(", ");
  const more = rows.length > MAX_LISTED_ROWS ? ` and ${rows.length - MAX_LISTED_ROWS} more` : "";
  const subject = rows.length === 1 ? `Row ${listed}` : `Rows ${listed}${more}`;
  return `${subject} ${rows.length === 1 ? "has" : "have"} ${problem}. ${fix}`;
}

function rowsWhere(items: QueueItem[], predicate: (item: QueueItem) => boolean): number[] {
  return items.flatMap((item, index) => (predicate(item) ? [index + 1] : []));
}

function validateSpeakerConfig(
  config: SpeakerConfig,
  voicesByKey: ReadonlyMap<string, Voice>,
): string | undefined {
  switch (config.mode) {
    case "single":
      if (!config.singleSpeaker) return "Choose a speaker for Single Speaker mode.";
      return voicesByKey.has(config.singleSpeaker)
        ? undefined
        : "The selected speaker is no longer available. Choose another speaker.";
    case "perFile":
      return undefined;
    case "random":
    case "roundRobin": {
      const label = config.mode === "random" ? "Random Assignment" : "Round Robin";
      if (config.selectedVoices.length === 0) {
        return `Select at least one speaker for ${label} mode.`;
      }
      return config.selectedVoices.every((key) => voicesByKey.has(key))
        ? undefined
        : "Some selected speakers are no longer available. Update your speaker selection.";
    }
  }
}

/**
 * Validates the queue and resolves a speaker and speed for every row that needs (re)generating.
 * Rows whose audio already matches the current settings are skipped.
 */
export function planGeneration(
  items: QueueItem[],
  config: SpeakerConfig,
  globalSpeed: number,
  voicesByKey: ReadonlyMap<string, Voice>,
  random: RandomSource = Math.random,
): GenerationPlan {
  if (items.length === 0) {
    return {
      ok: false,
      errors: ["Your queue is empty. Paste some vocabulary above or click Add File."],
    };
  }
  if (voicesByKey.size === 0) {
    return {
      ok: false,
      errors: ["Voices haven't loaded yet. Wait for them to load, or click Retry in Speaker Settings."],
    };
  }

  const errors: string[] = [];
  const configError = validateSpeakerConfig(config, voicesByKey);
  if (configError) errors.push(configError);

  const missingText = rowsWhere(items, (item) => item.text.trim() === "");
  if (missingText.length > 0) {
    errors.push(describeRows(missingText, "no speech text", "Type a word or phrase, or remove the row."));
  }
  const missingFilename = rowsWhere(items, (item) => item.filename.trim() === "");
  if (missingFilename.length > 0) {
    errors.push(describeRows(missingFilename, "no filename", "Enter one, or tick Auto."));
  }
  if (config.mode === "perFile") {
    const missingSpeaker = rowsWhere(items, (item) => !item.speaker || !voicesByKey.has(item.speaker));
    if (missingSpeaker.length > 0) {
      errors.push(
        describeRows(
          missingSpeaker,
          "no speaker",
          "Pick one in the Speaker column, or switch to another assignment mode.",
        ),
      );
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const jobs = items.flatMap((item, index): GenerationJob[] => {
    if (isUpToDate(item, index, config, globalSpeed)) return [];
    const speakerKey = resolveSpeaker(item, index, config, random);
    const voice = speakerKey ? voicesByKey.get(speakerKey) : undefined;
    if (!voice) return [];
    return [{ itemId: item.id, text: item.text.trim(), voice, speed: effectiveSpeed(item, globalSpeed) }];
  });
  return { ok: true, jobs };
}
