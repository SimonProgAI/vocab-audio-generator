import { describe, expect, it } from "vitest";
import type { QueueItem, SpeakerConfig, Voice } from "../types/queue";
import { isUpToDate, planGeneration, previewSpeaker, resolveSpeaker } from "./assignment";

const MELO = "melotts:FR";
const OPEN = "openvoice:FR";
const SIWIS = "piper:siwis";

const voices: Voice[] = [
  { key: MELO, id: "FR", name: "Mélo", language: "fr", model: "melotts" },
  { key: OPEN, id: "FR", name: "Open", language: "fr", model: "openvoice" },
  { key: SIWIS, id: "siwis", name: "Siwis", language: "fr-FR", model: "piper" },
];
const voicesByKey = new Map(voices.map((voice) => [voice.key, voice]));

function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "row",
    text: "bonjour",
    filename: "bonjour",
    autoFilename: true,
    speed: 1,
    overrideSpeed: false,
    status: "pending",
    ...overrides,
  };
}

function config(overrides: Partial<SpeakerConfig> = {}): SpeakerConfig {
  return { mode: "single", selectedVoices: [], ...overrides };
}

describe("previewSpeaker", () => {
  it("uses the single speaker in single mode", () => {
    expect(previewSpeaker(item(), 0, config({ singleSpeaker: MELO }))).toBe(MELO);
  });

  it("uses the row's own speaker in per-file mode", () => {
    expect(previewSpeaker(item({ speaker: SIWIS }), 0, config({ mode: "perFile" }))).toBe(SIWIS);
  });

  it("cycles through the selected voices by row index in round-robin mode", () => {
    const roundRobin = config({ mode: "roundRobin", selectedVoices: [MELO, OPEN, SIWIS] });
    expect([0, 1, 2, 3].map((index) => previewSpeaker(item(), index, roundRobin))).toEqual([
      MELO,
      OPEN,
      SIWIS,
      MELO,
    ]);
  });

  it("is unknown in round-robin mode with no voices, and always in random mode", () => {
    expect(previewSpeaker(item(), 0, config({ mode: "roundRobin" }))).toBeUndefined();
    expect(previewSpeaker(item(), 0, config({ mode: "random", selectedVoices: [MELO] }))).toBeUndefined();
  });
});

describe("resolveSpeaker", () => {
  const random = config({ mode: "random", selectedVoices: [MELO, OPEN, SIWIS] });

  it.each([
    [0, MELO],
    [0.5, OPEN],
    [0.99, SIWIS],
  ])("picks from the random pool (random() = %d → %s)", (value, expected) => {
    expect(resolveSpeaker(item(), 0, random, () => value)).toBe(expected);
  });

  it("matches previewSpeaker in the other modes", () => {
    const roundRobin = config({ mode: "roundRobin", selectedVoices: [MELO, OPEN] });
    expect(resolveSpeaker(item(), 1, roundRobin)).toBe(OPEN);
  });
});

describe("isUpToDate", () => {
  const single = config({ singleSpeaker: MELO });
  const done = (overrides: Partial<QueueItem> = {}) =>
    item({ status: "completed", generatedWith: { speaker: MELO, speed: 1 }, ...overrides });

  it("is true when a completed row still matches the speaker and speed", () => {
    expect(isUpToDate(done(), 0, single, 1)).toBe(true);
  });

  it("is false for rows that aren't completed", () => {
    expect(isUpToDate(done({ status: "pending" }), 0, single, 1)).toBe(false);
    expect(isUpToDate(item({ status: "completed" }), 0, single, 1)).toBe(false);
  });

  it("is false when the global speed changed", () => {
    expect(isUpToDate(done(), 0, single, 1.2)).toBe(false);
  });

  it("compares against the row's own speed when it overrides the global one", () => {
    const overridden = done({ overrideSpeed: true, speed: 0.8, generatedWith: { speaker: MELO, speed: 0.8 } });
    expect(isUpToDate(overridden, 0, single, 1.5)).toBe(true);
  });

  it("is false when the speaker changed", () => {
    expect(isUpToDate(done(), 0, config({ singleSpeaker: OPEN }), 1)).toBe(false);
  });

  it("in random mode, only checks that the speaker is still in the pool", () => {
    expect(isUpToDate(done(), 0, config({ mode: "random", selectedVoices: [OPEN, MELO] }), 1)).toBe(true);
    expect(isUpToDate(done(), 0, config({ mode: "random", selectedVoices: [OPEN] }), 1)).toBe(false);
  });
});

describe("planGeneration", () => {
  it("rejects an empty queue", () => {
    expect(planGeneration([], config({ singleSpeaker: MELO }), 1, voicesByKey)).toEqual({
      ok: false,
      errors: ["Your queue is empty. Paste some vocabulary above or click Add File."],
    });
  });

  it("rejects planning before voices have loaded", () => {
    const plan = planGeneration([item()], config({ singleSpeaker: MELO }), 1, new Map());
    expect(plan).toMatchObject({ ok: false, errors: [expect.stringContaining("Voices haven't loaded")] });
  });

  it("reports every problem at once", () => {
    const items = [item({ text: "  " }), item({ filename: "" })];
    expect(planGeneration(items, config(), 1, voicesByKey)).toEqual({
      ok: false,
      errors: [
        "Choose a speaker for Single Speaker mode.",
        "Row 1 has no speech text. Type a word or phrase, or remove the row.",
        "Row 2 has no filename. Enter one, or tick Auto.",
      ],
    });
  });

  it("lists at most 8 row numbers", () => {
    const items = Array.from({ length: 10 }, () => item({ text: "" }));
    expect(planGeneration(items, config({ singleSpeaker: MELO }), 1, voicesByKey)).toEqual({
      ok: false,
      errors: [
        "Rows 1, 2, 3, 4, 5, 6, 7, 8 and 2 more have no speech text. Type a word or phrase, or remove the row.",
      ],
    });
  });

  it("rejects speakers that are no longer available", () => {
    expect(planGeneration([item()], config({ singleSpeaker: "gone:X" }), 1, voicesByKey)).toEqual({
      ok: false,
      errors: ["The selected speaker is no longer available. Choose another speaker."],
    });
    expect(
      planGeneration([item()], config({ mode: "random", selectedVoices: [MELO, "gone:X"] }), 1, voicesByKey),
    ).toEqual({
      ok: false,
      errors: ["Some selected speakers are no longer available. Update your speaker selection."],
    });
  });

  it("requires at least one selected voice in round-robin and random modes", () => {
    expect(planGeneration([item()], config({ mode: "roundRobin" }), 1, voicesByKey)).toEqual({
      ok: false,
      errors: ["Select at least one speaker for Round Robin mode."],
    });
  });

  it("requires a valid speaker on every row in per-file mode", () => {
    const items = [item(), item({ speaker: MELO }), item({ speaker: "gone:X" })];
    expect(planGeneration(items, config({ mode: "perFile" }), 1, voicesByKey)).toEqual({
      ok: false,
      errors: [
        "Rows 1, 3 have no speaker. Pick one in the Speaker column, or switch to another assignment mode.",
      ],
    });
  });

  it("builds jobs for rows that need audio and skips rows that are up to date", () => {
    const items = [
      item({ id: "a", text: " un " }),
      item({ id: "b", text: "deux", status: "completed", generatedWith: { speaker: OPEN, speed: 1 } }),
      item({ id: "c", text: "trois", overrideSpeed: true, speed: 0.8 }),
      item({ id: "d", text: "quatre", status: "completed", generatedWith: { speaker: MELO, speed: 1.5 } }),
    ];
    const plan = planGeneration(items, config({ mode: "roundRobin", selectedVoices: [MELO, OPEN] }), 1, voicesByKey);
    expect(plan).toEqual({
      ok: true,
      jobs: [
        { itemId: "a", text: "un", voice: voicesByKey.get(MELO), speed: 1 },
        { itemId: "c", text: "trois", voice: voicesByKey.get(MELO), speed: 0.8 },
        // Row d was generated at 1.5× but the global speed is now 1×, so it is regenerated.
        { itemId: "d", text: "quatre", voice: voicesByKey.get(OPEN), speed: 1 },
      ],
    });
  });
});
