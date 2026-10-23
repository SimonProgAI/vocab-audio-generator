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
