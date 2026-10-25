import { describe, expect, it } from "vitest";
import type { Voice } from "../types/queue";
import { arrangeVoices, voiceTier } from "./voices";

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
