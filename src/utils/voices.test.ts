import { describe, expect, it } from "vitest";
import type { Voice } from "../types/queue";
import { arrangeVoices, followsSpeed, formatVoiceLabel, ignoresSpeed, isHiddenVoice, isVoiceOrder, voiceTier } from "./voices";

function voice(model: string | undefined, name: string): Voice {
  return { key: `${model}:${name}`, id: name, name, language: "fr", model };
}

describe("voiceTier", () => {
  it.each([
    ["piper", "free"],
    ["kokoro", "free"],
    ["cosyvoice2", "standard"],
    ["qwen3-tts", "standard"],
    ["openvoice", "premium"],
    ["zonos", "unknown"],
    ["constructor", "unknown"],
    [undefined, "unknown"],
  ])("%s → %s", (model, tier) => {
    expect(voiceTier({ model })).toBe(tier);
  });
});

describe("arrangeVoices", () => {
  const voices = [
    voice("openvoice", "Alice"),
    voice("piper", "Bruno"),
    voice("zonos", "Chloé"),
    voice("bark", "Denis"),
    voice("melotts", "Élise"),
  ];

  it("keeps one unlabeled group, in the given order, when sorting by name", () => {
    expect(arrangeVoices(voices, "name")).toEqual([{ key: "all", voices }]);
  });

  it("groups by tier, cheapest first, keeping the given order within each tier", () => {
    const groups = arrangeVoices(voices, "tier");
    expect(groups.map((group) => [group.label, group.voices.map((v) => v.name)])).toEqual([
      ["Free tier · 1 credit per character", ["Bruno", "Élise"]],
      ["Standard · 2 credits per character", ["Denis"]],
      ["Premium · 4 credits per character", ["Alice"]],
      ["Price not known yet", ["Chloé"]],
    ]);
  });

  it("leaves out empty tiers", () => {
    expect(arrangeVoices([voice("piper", "Bruno")], "tier").map((group) => group.key)).toEqual(["free"]);
    expect(arrangeVoices([], "tier")).toEqual([]);
  });
});

describe("isHiddenVoice", () => {
  it.each([
    "bark:v2/fr_speaker_0",
    "bark:v2/fr_speaker_1",
    "cosyvoice2:French Female",
    "cosyvoice3:法文女",
    "moss-tts:default_fr",
    "moss-tts-nano:default_fr",
    "pocket-tts:jean_fr",
    "zonos:french_male",
  ])("hides %s, which failed the French check", (key) => {
    expect(isHiddenVoice({ key })).toBe(true);
  });

  it.each(["bark-small:v2/fr_speaker_0", "pocket-tts:fantine_fr", "vits:css10_fr", "piper:fr_FR-siwis-medium", "bark:v2/en_speaker_0"])(
    "keeps %s",
    (key) => {
      expect(isHiddenVoice({ key })).toBe(false);
    },
  );
});

describe("ignoresSpeed", () => {
  it.each([
    "openvoice:FR",
    "vits:css10_fr",
    "pocket-tts:fantine_fr",
    "qwen3-tts:eric_fr",
    "qwen3-tts:vivian_fr",
    "bark-small:v2/fr_speaker_0",
  ])("marks %s, whose audio didn't follow the speed check", (key) => {
    expect(ignoresSpeed({ key })).toBe(true);
  });

  it.each(["kokoro:ff_siwis", "melotts:FR", "piper:fr_FR-siwis-medium"])("doesn't mark %s, which follows speed", (key) => {
    expect(ignoresSpeed({ key })).toBe(false);
  });
});

describe("formatVoiceLabel", () => {
  it("shows the gender and model", () => {
    expect(formatVoiceLabel({ key: "piper:siwis", id: "siwis", name: "Siwis", language: "fr", gender: "female", model: "piper" })).toBe(
      "Siwis (female, piper)",
    );
  });

  it("says when a voice ignores the speed setting", () => {
    expect(formatVoiceLabel({ key: "vits:css10_fr", id: "css10_fr", name: "CSS10 (French)", language: "fr", model: "vits" })).toBe(
      "CSS10 (French) (vits) · ignores speed",
    );
  });

  it("shows just the name when there are no details", () => {
    expect(formatVoiceLabel({ key: "custom", id: "custom", name: "Custom", language: "fr" })).toBe("Custom");
  });
});

describe("followsSpeed", () => {
  it.each(["kokoro:ff_siwis", "melotts:FR", "piper:fr_FR-siwis-medium"])("is true for %s, which the check found to follow speed", (key) => {
    expect(followsSpeed({ key })).toBe(true);
  });

  it.each(["openvoice:FR", "vits:css10_fr", "piper:en_US-lessac-medium", "bark:v2/en_speaker_0"])(
    "is false for %s: it ignores speed, or was never checked",
    (key) => {
      expect(followsSpeed({ key })).toBe(false);
    },
  );
});

describe("arrangeVoices followsSpeed", () => {
  const french: Voice[] = [
    { key: "openvoice:FR", id: "FR", name: "French", language: "fr", model: "openvoice" },
    { key: "piper:fr_FR-siwis-medium", id: "fr_FR-siwis-medium", name: "Siwis (French)", language: "fr", model: "piper" },
    { key: "vits:css10_fr", id: "css10_fr", name: "CSS10 (French)", language: "fr", model: "vits" },
    { key: "kokoro:ff_siwis", id: "ff_siwis", name: "Siwis", language: "fr", model: "kokoro" },
  ];

  it("keeps only voices known to follow speed, grouped by price", () => {
    expect(arrangeVoices(french, "followsSpeed").map((group) => [group.label, group.voices.map((v) => v.key)])).toEqual([
      ["Free tier · 1 credit per character", ["piper:fr_FR-siwis-medium", "kokoro:ff_siwis"]],
    ]);
  });

  it("is empty when none of the voices is known to follow speed", () => {
    expect(arrangeVoices(french.slice(0, 1), "followsSpeed")).toEqual([]);
  });
});

describe("isVoiceOrder", () => {
  it("accepts the three orders and nothing else", () => {
    expect(["name", "tier", "followsSpeed"].every(isVoiceOrder)).toBe(true);
    expect(["price", "", undefined, 3].some(isVoiceOrder)).toBe(false);
  });
});
