import { describe, expect, it } from "vitest";
import type { Voice } from "../types/queue";
import {
  DEFAULT_VOICE_LIST,
  arrangeVoices,
  emptyListMessage,
  followsSpeed,
  formatVoiceLabel,
  ignoresSpeed,
  isHiddenVoice,
  voiceTier,
  wasTested,
  type VoiceListOptions,
} from "./voices";

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

const OFF: VoiceListOptions = { testedOnly: false, byPrice: false, followsSpeed: false, byName: false };
const names = (groups: ReturnType<typeof arrangeVoices>) => groups.map((group) => [group.label, group.voices.map((v) => v.name)]);

describe("arrangeVoices", () => {
  // Deliberately not alphabetical, like TTS.ai's own order.
  const voices = [
    voice("melotts", "Élise"),
    voice("openvoice", "Alice"),
    voice("zonos", "Chloé"),
    voice("piper", "Bruno"),
    voice("bark", "Denis"),
  ];

  it("keeps TTS.ai's order in one unlabeled group with every box off", () => {
    expect(arrangeVoices(voices, OFF)).toEqual([{ key: "all", voices }]);
  });

  it("sorts A–Z by name, accents included", () => {
    expect(names(arrangeVoices(voices, { ...OFF, byName: true }))).toEqual([[undefined, ["Alice", "Bruno", "Chloé", "Denis", "Élise"]]]);
  });

  it("puts the same name in model order", () => {
    const twins = [voice("qwen3-tts", "Siwis"), voice("kokoro", "Siwis")];
    expect(arrangeVoices(twins, { ...OFF, byName: true })[0]?.voices.map((v) => v.model)).toEqual(["kokoro", "qwen3-tts"]);
  });

  it("groups by price, cheapest first, keeping TTS.ai's order inside each group", () => {
    expect(names(arrangeVoices(voices, { ...OFF, byPrice: true }))).toEqual([
      ["Free tier · 1 credit per character", ["Élise", "Bruno"]],
      ["Standard · 2 credits per character", ["Denis"]],
      ["Premium · 4 credits per character", ["Alice"]],
      ["Price not known yet", ["Chloé"]],
    ]);
  });

  it("groups by price with names A–Z inside each group when both are on", () => {
    expect(names(arrangeVoices(voices, { ...OFF, byPrice: true, byName: true }))[0]).toEqual([
      "Free tier · 1 credit per character",
      ["Bruno", "Élise"],
    ]);
  });

  it("leaves out empty tiers, and returns nothing when nothing is left", () => {
    expect(arrangeVoices([voice("piper", "Bruno")], { ...OFF, byPrice: true }).map((group) => group.key)).toEqual(["free"]);
    expect(arrangeVoices([], { ...OFF, byPrice: true })).toEqual([]);
    expect(arrangeVoices([], OFF)).toEqual([]);
  });
});

describe("isHiddenVoice", () => {
  it.each([
    "bark:v2/fr_speaker_0",
    "bark:v2/fr_speaker_1",
    "bark-small:v2/fr_speaker_0",
    "cosyvoice2:French Female",
    "cosyvoice3:法文女",
    "moss-tts:default_fr",
    "moss-tts-nano:default_fr",
    "pocket-tts:jean_fr",
    "zonos:french_male",
  ])("hides %s, which failed the French check", (key) => {
    expect(isHiddenVoice({ key })).toBe(true);
  });

  it.each(["pocket-tts:fantine_fr", "vits:css10_fr", "piper:fr_FR-siwis-medium", "bark:v2/en_speaker_0", "bark-small:v2/en_speaker_0"])(
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

describe("arrangeVoices filters", () => {
  const voices: Voice[] = [
    { key: "openvoice:FR", id: "FR", name: "French", language: "fr", model: "openvoice" },
    { key: "piper:fr_FR-siwis-medium", id: "fr_FR-siwis-medium", name: "Siwis (French)", language: "fr", model: "piper" },
    { key: "bark:v2/en_speaker_0", id: "v2/en_speaker_0", name: "English Male 1", language: "en", model: "bark" },
    { key: "kokoro:ff_siwis", id: "ff_siwis", name: "Siwis", language: "fr", model: "kokoro" },
  ];
  const keys = (options: VoiceListOptions) => arrangeVoices(voices, options).flatMap((group) => group.voices.map((v) => v.key));

  it("keeps only tested voices", () => {
    expect(keys({ ...OFF, testedOnly: true })).toEqual(["openvoice:FR", "piper:fr_FR-siwis-medium", "kokoro:ff_siwis"]);
  });

  it("keeps only voices that respond to speed control", () => {
    expect(keys({ ...OFF, followsSpeed: true })).toEqual(["piper:fr_FR-siwis-medium", "kokoro:ff_siwis"]);
  });

  it("combines all four boxes", () => {
    expect(names(arrangeVoices(voices, { testedOnly: true, byPrice: true, followsSpeed: true, byName: true }))).toEqual([
      ["Free tier · 1 credit per character", ["Siwis", "Siwis (French)"]],
    ]);
  });

  it("is empty when no voice gets through", () => {
    expect(arrangeVoices(voices.slice(2, 3), { ...OFF, testedOnly: true })).toEqual([]);
  });
});

describe("wasTested", () => {
  it.each(["kokoro:ff_siwis", "melotts:FR", "piper:fr_FR-siwis-medium", "openvoice:FR", "vits:css10_fr", "pocket-tts:fantine_fr", "qwen3-tts:eric_fr", "qwen3-tts:vivian_fr"])(
    "is true for %s, one of the 8 French voices still shown",
    (key) => {
      expect(wasTested({ key })).toBe(true);
    },
  );

  it.each(["bark:v2/en_speaker_0", "piper:en_US-lessac-medium", "kokoro:af_heart"])("is false for %s, which was never checked", (key) => {
    expect(wasTested({ key })).toBe(false);
  });
});

describe("DEFAULT_VOICE_LIST", () => {
  it("starts with tested voices only, A–Z", () => {
    expect(DEFAULT_VOICE_LIST).toEqual({ testedOnly: true, byPrice: false, followsSpeed: false, byName: true });
  });
});

describe("emptyListMessage", () => {
  it("explains which box emptied the list", () => {
    expect(emptyListMessage({ ...OFF, testedOnly: true, followsSpeed: true })).toBe(
      "No tested voices here. Only French voices have been tested so far.",
    );
    expect(emptyListMessage({ ...OFF, followsSpeed: true })).toBe("None of these voices is known to respond to speed control.");
    expect(emptyListMessage(OFF)).toBe("No voices to show.");
  });
});
