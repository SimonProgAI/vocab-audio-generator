import type { Voice } from "../types/queue";

export const ALL_LANGUAGES = "all";

export interface LanguageSummary {
  code: string;
  label: string;
  count: number;
}

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

/** "fr-FR" → "fr". Voices are grouped by primary language so regional variants stay together. */
export function primaryLanguage(code: string): string {
  return (code.split(/[-_]/)[0] ?? "").toLowerCase();
}

function languageLabel(code: string): string {
  if (!code) return "Unknown language";
  try {
    return languageNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export function summarizeLanguages(voices: readonly Voice[]): LanguageSummary[] {
  const counts = new Map<string, number>();
  for (const voice of voices) {
    const code = primaryLanguage(voice.language);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts]
    .map(([code, count]) => ({ code, label: languageLabel(code), count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** French is the point of this app, so prefer it whenever the API offers French voices. */
export function defaultLanguage(languages: readonly LanguageSummary[]): string {
  return languages.some((language) => language.code === "fr") ? "fr" : ALL_LANGUAGES;
}

export function matchesLanguage(voice: Voice, language: string): boolean {
  return language === ALL_LANGUAGES || primaryLanguage(voice.language) === language;
}

/**
 * Voices whose audio doesn't follow the speed setting. Checked on 2026-10-26 by timing "une
 * rivière" at 0.5×, 1× and 2×: a voice that follows it comes out about twice as long at 0.5× and
 * half as long at 2× (kokoro, melotts and piper did). These stayed the same length, got shorter at
 * 0.5×, or got longer at 2×.
 */
const IGNORES_SPEED: ReadonlySet<string> = new Set([
  "openvoice:FR", // 0.97 s at every speed.
  "vits:css10_fr", // 1.24 s, 1.18 s, 1.18 s.
  "pocket-tts:fantine_fr", // Shorter at 0.5× (1.27 s) than at 1× (1.68 s).
  "qwen3-tts:eric_fr", // Shorter at 0.5× (1.61 s) than at 1× (2.71 s).
  "qwen3-tts:vivian_fr", // Shorter at 0.5× (1.99 s) than at 1× (2.57 s).
]);

export function ignoresSpeed(voice: Pick<Voice, "key">): boolean {
  return IGNORES_SPEED.has(voice.key);
}

/** Voices the same check found to follow the speed setting. Unchecked voices aren't assumed to. */
const FOLLOWS_SPEED: ReadonlySet<string> = new Set([
  "kokoro:ff_siwis", // 2.98 s, 1.51 s, 0.79 s.
  "melotts:FR", // 1.70 s, 0.99 s, 0.57 s.
  "piper:fr_FR-siwis-medium", // 1.89 s, 1.07 s, 0.58 s.
]);

export function followsSpeed(voice: Pick<Voice, "key">): boolean {
  return FOLLOWS_SPEED.has(voice.key);
}

/**
 * Every voice that passed the French check also went through the speed check, so a known speed
 * result means the voice was tested. Today that's the French voices still shown; other languages
 * haven't been checked.
 */
export function wasTested(voice: Pick<Voice, "key">): boolean {
  return followsSpeed(voice) || ignoresSpeed(voice);
}

export function formatVoiceLabel(voice: Voice): string {
  const details = [voice.gender, voice.model].filter(Boolean).join(", ");
  const label = details ? `${voice.name} (${details})` : voice.name;
  return ignoresSpeed(voice) ? `${label} · ignores speed` : label;
}

/**
 * Voices labeled French that don't reliably speak it, so the app leaves them out. Checked on
 * 2026-10-26: each voice said a word and a sentence, and TTS.ai's speech-to-text (Whisper)
 * transcribed them. These added words, repeated or garbled the text, or always fail to generate.
 * bark-small passed that check but was dropped later: its clips stop abruptly mid-sound, it
 * ignores the speed setting, and it is slow.
 */
const HIDDEN_VOICES: ReadonlySet<string> = new Set([
  "bark:v2/fr_speaker_0", // Added a word: "Bernie, une rivière?"
  "bark:v2/fr_speaker_1", // Added words: "Bonjour tout lui, je m'appelle…"
  "bark-small:v2/fr_speaker_0", // Clips end abruptly mid-sound, heard as "Une rivière est..."; ignores speed.
  "cosyvoice2:French Female", // Said the word 5 times, heard as English; garbled the sentence.
  "cosyvoice3:法文女", // Said the word 4 times; the sentence timed out after 8 minutes.
  "moss-tts:default_fr", // TTS.ai: "model_disabled".
  "moss-tts-nano:default_fr", // Garbled the word: "Mais... Où n'auriez-vous..."
  "pocket-tts:jean_fr", // Cut the word short, heard as "On vit bien." even with French specified.
  "zonos:french_male", // TTS.ai: "invalid_model".
]);

export function isHiddenVoice(voice: Pick<Voice, "key">): boolean {
  return HIDDEN_VOICES.has(voice.key);
}

export function voiceName(voiceKey: string, voicesByKey: ReadonlyMap<string, Voice>): string {
  return voicesByKey.get(voiceKey)?.name ?? voiceKey;
}

/** TTS.ai price tiers: free models use 1 credit per character of text, standard 2, premium 4. */
export type VoiceTier = "free" | "standard" | "premium" | "unknown";

/**
 * The voice list has no pricing field, so tiers are mapped per model. Measured from `credits_used`
 * in `npm run benchmark:voices` (French voices, 2026-10-25); vits, tortoise and chatterbox come from
 * https://tts.ai/api. The docs list kokoro as standard, but it was charged 1 credit per character.
 */
const MODEL_TIERS: ReadonlyMap<string, Exclude<VoiceTier, "unknown">> = new Map([
  ["kokoro", "free"],
  ["melotts", "free"],
  ["piper", "free"],
  ["pocket-tts", "free"],
  ["vits", "free"],
  ["bark", "standard"],
  ["bark-small", "standard"],
  ["cosyvoice2", "standard"],
  ["cosyvoice3", "standard"],
  ["moss-tts-nano", "standard"],
  ["qwen3-tts", "standard"],
  ["chatterbox", "premium"],
  ["openvoice", "premium"],
  ["tortoise", "premium"],
]);

const TIER_LABELS: Readonly<Record<VoiceTier, string>> = {
  free: "Free tier · 1 credit per character",
  standard: "Standard · 2 credits per character",
  premium: "Premium · 4 credits per character",
  unknown: "Price not known yet",
};

const TIER_ORDER: readonly VoiceTier[] = ["free", "standard", "premium", "unknown"];

export function voiceTier(voice: Pick<Voice, "model">): VoiceTier {
  return (voice.model && MODEL_TIERS.get(voice.model)) || "unknown";
}

/** How every speaker list is filtered and sorted (the Sort voices checkboxes). */
export interface VoiceListOptions {
  /** Only voices that were tested (see wasTested). */
  testedOnly: boolean;
  /** Group by price tier, cheapest first. */
  byPrice: boolean;
  /** Only voices the speed check found to respond to the speed setting. */
  followsSpeed: boolean;
  /** A–Z by name (within each price group); otherwise TTS.ai's own order. */
  byName: boolean;
}

export const DEFAULT_VOICE_LIST: VoiceListOptions = { testedOnly: true, byPrice: false, followsSpeed: false, byName: true };

export const VOICE_LIST_CHECKBOXES: ReadonlyArray<{ option: keyof VoiceListOptions; label: string }> = [
  { option: "testedOnly", label: "Tested voices only" },
  { option: "byPrice", label: "Price, low to high" },
  { option: "followsSpeed", label: "Responds to speed control" },
  { option: "byName", label: "By name (A–Z)" },
];

function byName(a: Voice, b: Voice): number {
  return a.name.localeCompare(b.name) || (a.model ?? "").localeCompare(b.model ?? "");
}

export interface VoiceGroup {
  key: string;
  /** Heading for the group; undefined when the list isn't grouped. */
  label?: string;
  voices: Voice[];
}

/**
 * Applies the filters, then sorts: by price groups the voices by tier (empty tiers are left out),
 * and by name orders them A–Z, inside each group when both are on. With neither, voices keep
 * TTS.ai's order. Returns no groups when no voice is left.
 */
export function arrangeVoices(voices: readonly Voice[], options: VoiceListOptions): VoiceGroup[] {
  const filtered = voices.filter(
    (voice) => (!options.testedOnly || wasTested(voice)) && (!options.followsSpeed || followsSpeed(voice)),
  );
  const shown = options.byName ? [...filtered].sort(byName) : filtered;
  if (!options.byPrice) return shown.length > 0 ? [{ key: "all", voices: shown }] : [];
  return TIER_ORDER.map((tier) => ({
    key: tier,
    label: TIER_LABELS[tier],
    voices: shown.filter((voice) => voiceTier(voice) === tier),
  })).filter((group) => group.voices.length > 0);
}

/** Why a list came out empty, in the words of the Sort voices checkboxes. */
export function emptyListMessage(options: VoiceListOptions): string {
  if (options.testedOnly) return "No tested voices here. Only French voices have been tested so far.";
  if (options.followsSpeed) return "None of these voices is known to respond to speed control.";
  return "No voices to show.";
}
