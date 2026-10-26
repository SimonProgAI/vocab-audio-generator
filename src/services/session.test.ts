// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueItem } from "../types/queue";
import { SESSION_KEY, clearSession, loadSession, parseSession, saveSession, type SessionSnapshot } from "./session";

function row(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "row-1",
    text: "une rivière",
    filename: "une_riviere",
    autoFilename: true,
    speed: 1,
    overrideSpeed: false,
    status: "pending",
    ...overrides,
  };
}

const snapshot: SessionSnapshot = {
  items: [
    row(),
    row({
      id: "row-2",
      text: "un champ",
      filename: "un_champ",
      status: "completed",
      speaker: "piper:siwis",
      jobId: "job-2",
      downloadUrl: "https://cdn.tts.ai/job-2/tts_output.mp3",
      generatedWith: { speaker: "piper:siwis", speed: 1.2 },
    }),
    row({ id: "row-3", status: "failed", error: "Voice crashed", overrideSpeed: true, speed: 0.8 }),
  ],
  draft: "une ferme\nun village",
  settings: {
    config: { mode: "roundRobin", selectedVoices: ["piper:siwis", "melotts:FR"] },
    globalSpeed: 1.2,
    languageChoice: "all",
    voiceList: { testedOnly: true, byPrice: true, followsSpeed: false, byName: true },
  },
  credits: { used: 319, reportedRemaining: 2_415_000 },
};

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("saveSession and loadSession", () => {
  it("round-trip the queue and settings", () => {
    saveSession(snapshot);
    expect(loadSession()).toEqual({ ...snapshot, interrupted: 0 });
  });

  it("find nothing when nothing was saved", () => {
    expect(loadSession()).toBeUndefined();
  });

  it("ignore data that isn't valid JSON", () => {
    sessionStorage.setItem(SESSION_KEY, "{oops");
    expect(loadSession()).toBeUndefined();
  });

  it("drop the previous copy when a newer one can't be saved, so a reload can't restore stale rows", () => {
    saveSession(snapshot);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    saveSession({ ...snapshot, items: [...snapshot.items, row({ id: "row-4" })] });
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("keep working when sessionStorage is full or blocked", () => {
    const blocked = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(blocked);

    expect(() => saveSession(snapshot)).not.toThrow();
    expect(loadSession()).toBeUndefined();
    expect(() => clearSession()).not.toThrow();
  });

  it("keep working when the browser refuses access to sessionStorage itself", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    expect(() => saveSession(snapshot)).not.toThrow();
    expect(loadSession()).toBeUndefined();
  });
});

describe("clearSession", () => {
  it("removes the saved session", () => {
    saveSession(snapshot);
    clearSession();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(loadSession()).toBeUndefined();
  });
});

describe("parseSession", () => {
  it("restores an empty Bulk Import box when no valid text was saved", () => {
    expect(parseSession({ items: [] })?.draft).toBe("");
    expect(parseSession({ items: [], draft: 42 })?.draft).toBe("");
    expect(parseSession({ items: [], draft: "une ferme" })?.draft).toBe("une ferme");
  });

  it("restores the credit counter, or none when the saved one is invalid", () => {
    expect(parseSession({ items: [], credits: { used: 44 } })?.credits).toEqual({ used: 44 });
    expect(parseSession({ items: [], credits: { used: 44, reportedRemaining: -1 } })?.credits).toEqual({ used: 44 });
    for (const credits of [undefined, "44", { used: -3 }, { used: Number.NaN }, { reportedRemaining: 10 }]) {
      expect(parseSession({ items: [], credits })?.credits).toBeUndefined();
    }
  });

  it("rejects data without a list of rows", () => {
    for (const data of [null, "text", [], {}, { items: "rows" }]) {
      expect(parseSession(data)).toBeUndefined();
    }
  });

  it("keeps rows that were still generating with their job, so the app can check on it again", () => {
    const items = [
      row({ id: "a", status: "queued", jobId: "job-a", speaker: "piper:siwis" }),
      row({ id: "b", status: "processing", jobId: "job-b", speaker: "piper:siwis" }),
      row({ id: "c", status: "completed", jobId: "job-c", downloadUrl: "https://cdn.tts.ai/c.mp3" }),
    ];
    const restored = parseSession({ items });
    expect(restored?.interrupted).toBe(2);
    expect(restored?.items).toEqual(items);
  });

  it("restarts a generating row that has no job ID or speaker to pick up", () => {
    const restored = parseSession({
      items: [
        row({ id: "a", status: "queued", speaker: "piper:siwis" }),
        row({ id: "b", status: "processing", jobId: "job-b" }),
      ],
    });
    expect(restored?.interrupted).toBe(0);
    expect(restored?.items).toEqual([
      row({ id: "a", status: "pending", speaker: "piper:siwis" }),
      row({ id: "b", status: "pending" }),
    ]);
  });

  it("drops invalid rows and repeated IDs but keeps the rest", () => {
    const restored = parseSession({
      items: [
        row(),
        null,
        "une ferme",
        { ...row({ id: "" }) },
        { ...row({ id: "too-fast" }), speed: 9 },
        { ...row({ id: "bad-status" }), status: "done" },
        { ...row({ id: "bad-auto" }), autoFilename: "yes" },
        { ...row({ id: "no-text" }), text: undefined },
        row({ text: "same ID again" }),
        row({ id: "row-2", text: "un champ" }),
      ],
    });
    expect(restored?.items.map((item) => item.id)).toEqual(["row-1", "row-2"]);
  });

  it("drops broken optional fields instead of the whole row", () => {
    const restored = parseSession({
      items: [{ ...row(), speaker: 42, jobId: null, generatedWith: { speaker: "piper:siwis" } }],
    });
    expect(restored?.items).toEqual([row()]);
    expect(restored?.items[0]?.speaker).toBeUndefined();
    expect(restored?.items[0]?.generatedWith).toBeUndefined();
  });

  it("leaves out invalid settings so the app falls back to its defaults", () => {
    expect(
      parseSession({
        items: [],
        settings: { config: { mode: "chaos" }, globalSpeed: 7, languageChoice: 3, voiceOrder: "price" },
      })?.settings,
    ).toEqual({});
    expect(parseSession({ items: [], settings: "fast" })?.settings).toEqual({});
    expect(parseSession({ items: [] })?.settings).toEqual({});
  });

  it("drops voices hidden since the session was saved from the speaker settings", () => {
    expect(
      parseSession({
        items: [],
        settings: {
          config: {
            mode: "roundRobin",
            singleSpeaker: "bark:v2/fr_speaker_0",
            selectedVoices: ["bark:v2/fr_speaker_0", "piper:fr_FR-siwis-medium", "pocket-tts:jean_fr"],
          },
        },
      })?.settings.config,
    ).toEqual({ mode: "roundRobin", singleSpeaker: undefined, selectedVoices: ["piper:fr_FR-siwis-medium"] });
  });

  it("lets rows still waiting for audio forget a hidden voice, but keeps it on rows that have audio", () => {
    const hidden = "bark:v2/fr_speaker_0";
    const restored = parseSession({
      items: [
        row({ id: "waiting", speaker: hidden }),
        row({ id: "failed", status: "failed", speaker: hidden, error: "Voice crashed" }),
        row({ id: "done", status: "completed", speaker: hidden, downloadUrl: "https://cdn.tts.ai/a.mp3", generatedWith: { speaker: hidden, speed: 1 } }),
        row({ id: "running", status: "processing", jobId: "job-1", speaker: hidden }),
      ],
    });
    expect(restored?.items.map((item) => [item.id, item.speaker])).toEqual([
      ["waiting", undefined],
      ["failed", undefined],
      ["done", hidden],
      ["running", hidden],
    ]);
  });

  it("refuses an old Sort voices value that only matches by accident, like a built-in property name", () => {
    for (const voiceOrder of ["constructor", "toString", "__proto__"]) {
      expect(parseSession({ items: [], settings: { voiceOrder } })?.settings).toEqual({});
    }
  });

  it("restores the Sort voices boxes, using the default for any missing or broken one", () => {
    expect(parseSession({ items: [], settings: { voiceList: { byPrice: true, testedOnly: "yes" } } })?.settings).toEqual({
      voiceList: { testedOnly: true, byPrice: true, followsSpeed: false, byName: true },
    });
    expect(parseSession({ items: [], settings: { voiceList: "all" } })?.settings).toEqual({});
  });

  it.each([
    ["name", { testedOnly: false, byPrice: false, followsSpeed: false, byName: true }],
    ["tier", { testedOnly: false, byPrice: true, followsSpeed: false, byName: true }],
    ["followsSpeed", { testedOnly: false, byPrice: true, followsSpeed: true, byName: true }],
  ])("turns the old Sort voices choice %j into the matching boxes", (voiceOrder, voiceList) => {
    expect(parseSession({ items: [], settings: { voiceOrder } })?.settings).toEqual({ voiceList });
  });

  it("keeps the valid settings when others are broken", () => {
    expect(
      parseSession({
        items: [],
        settings: {
          config: { mode: "random", singleSpeaker: 5, selectedVoices: ["piper:siwis", 1, null, "melotts:FR"] },
          globalSpeed: 0.8,
          languageChoice: null,
          voiceOrder: "sideways",
        },
      })?.settings,
    ).toEqual({
      config: { mode: "random", singleSpeaker: undefined, selectedVoices: ["piper:siwis", "melotts:FR"] },
      globalSpeed: 0.8,
      languageChoice: null,
    });
  });
});
