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

export function formatVoiceLabel(voice: Voice): string {
  const details = [voice.gender, voice.model].filter(Boolean).join(", ");
  return details ? `${voice.name} (${details})` : voice.name;
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

/** How every speaker list is ordered: alphabetically, or grouped by price tier (cheapest first). */
export type VoiceOrder = "name" | "tier";

export interface VoiceGroup {
  key: string;
  /** Heading for the group; undefined when the list isn't grouped. */
  label?: string;
  voices: Voice[];
}

/** Keeps the incoming (alphabetical) order within each group. Empty tiers are left out. */
export function arrangeVoices(voices: readonly Voice[], order: VoiceOrder): VoiceGroup[] {
  if (order === "name") return [{ key: "all", voices: [...voices] }];
  return TIER_ORDER.map((tier) => ({
    key: tier,
    label: TIER_LABELS[tier],
    voices: voices.filter((voice) => voiceTier(voice) === tier),
  })).filter((group) => group.voices.length > 0);
}
