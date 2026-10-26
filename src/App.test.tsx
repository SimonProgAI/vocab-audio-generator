// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { previewSpeaker } from "./services/assignment";
import { EXPIRED_AUDIO_MESSAGE, clearAudioCache, retainAudio } from "./services/audio";
import { SESSION_KEY, saveSession, type SessionSnapshot } from "./services/session";
import { clearVoiceSamples } from "./services/voiceSample";
import { server } from "./test/server";
import type { QueueItem } from "./types/queue";
import { DEFAULT_VOICE_LIST, arrangeVoiceList } from "./utils/voices";

// Wrapped, not replaced: each is called whenever the queue or the speaker lists render.
vi.mock("./services/assignment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/assignment")>();
  return { ...actual, previewSpeaker: vi.fn(actual.previewSpeaker) };
});
vi.mock("./services/audio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/audio")>();
  return { ...actual, retainAudio: vi.fn(actual.retainAudio) };
});
vi.mock("./utils/voices", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils/voices")>();
  return { ...actual, arrangeVoiceList: vi.fn(actual.arrangeVoiceList) };
});

const API = `${import.meta.env.VITE_TTS_API_ORIGIN}/v1`;
const PIPER = "piper:fr_FR-siwis-medium";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  clearAudioCache();
  clearVoiceSamples();
  // jsdom can't play audio, make object URLs, or follow a download link.
  URL.createObjectURL = vi.fn(() => "blob:clip");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  server.use(
    http.get(`${API}/voices/`, () =>
      HttpResponse.json({
        voices: [
          { id: "fr_FR-siwis-medium", model: "piper", name: "Siwis", language: "fr" },
          { id: "FR", model: "melotts", name: "French", language: "fr" },
        ],
      }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Renders the app and waits for the voice list, like a fresh page load. */
async function openApp() {
  const view = render(<App />);
  await screen.findByText(/2 voices loaded/);
  return view;
}

/** A refresh: the old page goes away and a new one starts from sessionStorage. */
async function reload(view: ReturnType<typeof render>) {
  view.unmount();
  return openApp();
}

function addWords(...words: string[]) {
  fireEvent.change(screen.getByLabelText("Vocabulary list"), { target: { value: words.join("\n") } });
  fireEvent.click(screen.getByRole("button", { name: "Add To Queue" }));
}

const rowText = (row: number) => screen.getByLabelText(`Speech text, row ${row}`);

/** Queries inside one queue row (the progress panel repeats status names like "Pending"). */
function queueRow(row: number) {
  const element = rowText(row).closest("tr");
  if (!element) throw new Error(`Queue row ${row} not found.`);
  return within(element);
}

function savedRow(overrides: Partial<QueueItem>): QueueItem {
  return {
    id: "row-1",
    text: "un champ",
    filename: "un_champ",
    autoFilename: true,
    speed: 1,
    overrideSpeed: false,
    status: "pending",
    ...overrides,
  };
}

/** Starts Generate All with a job that stays queued, so the run is still going. */
async function startGenerating() {
  server.use(
    http.post(`${API}/tts/`, () => HttpResponse.json({ uuid: "job-1", status: "queued" })),
    http.get(`${API}/speech/results/`, () => HttpResponse.json({ status: "processing" })),
  );
  fireEvent.change(screen.getByLabelText("Speaker for every file"), { target: { value: PIPER } });
  fireEvent.click(screen.getByRole("button", { name: "Generate All" }));
  await screen.findByText("Generating audio…");
  await queueRow(1).findByText("Queued");
}

describe("session persistence", () => {
  it("keeps the word list and settings after a reload", async () => {
    const view = await openApp();
    addWords("un champ", "une rivière");
    fireEvent.change(screen.getByLabelText("Global speed"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByLabelText("Price, low to high"));
    fireEvent.change(screen.getByLabelText("Speaker for every file"), { target: { value: PIPER } });

    await reload(view);

    expect(rowText(1)).toHaveProperty("value", "un champ");
    expect(rowText(2)).toHaveProperty("value", "une rivière");
    expect(screen.getByLabelText("Global speed")).toHaveProperty("value", "1.5");
    expect(screen.getByLabelText("Price, low to high")).toHaveProperty("checked", true);
    expect(screen.getByLabelText("Speaker for every file")).toHaveProperty("value", PIPER);
    expect(screen.getByText("Queue restored")).not.toBeNull();
  });

  it("keeps text typed into Bulk Import that wasn't added to the queue yet", async () => {
    const view = await openApp();
    fireEvent.change(screen.getByLabelText("Vocabulary list"), { target: { value: "une ferme\nun village" } });

    await reload(view);

    expect(screen.getByLabelText("Vocabulary list")).toHaveProperty("value", "une ferme\nun village");
    expect(screen.getByText("2 lines ready to add.")).not.toBeNull();
    expect(screen.getByText(/Your queue is empty/)).not.toBeNull();
  });

  it("doesn't bring back Bulk Import text that was already added", async () => {
    const view = await openApp();
    addWords("un champ", "une rivière");

    await reload(view);

    expect(screen.getByLabelText("Vocabulary list")).toHaveProperty("value", "");
    expect(rowText(2)).toHaveProperty("value", "une rivière");
  });

  it("keeps edits made after adding the words", async () => {
    const view = await openApp();
    addWords("un champ");
    fireEvent.change(rowText(1), { target: { value: "un grand champ" } });

    await reload(view);

    expect(rowText(1)).toHaveProperty("value", "un grand champ");
    expect(screen.getByLabelText("Filename, row 1")).toHaveProperty("value", "un_grand_champ");
  });

  it("checks on a generating row's job again after a reload, instead of paying for a new one", async () => {
    const view = await openApp();
    addWords("un champ");
    let submits = 0;
    server.use(
      http.post(`${API}/tts/`, () => {
        submits += 1;
        return HttpResponse.json({ uuid: "job-1", status: "queued" });
      }),
      http.get(`${API}/speech/results/`, () => HttpResponse.json({ status: "processing" })),
    );
    fireEvent.change(screen.getByLabelText("Speaker for every file"), { target: { value: PIPER } });
    fireEvent.click(screen.getByRole("button", { name: "Generate All" }));
    await queueRow(1).findByText("Queued");

    // The old page goes away; on the new one, TTS.ai reports the same job finished on the second check.
    const polled: Array<string | null> = [];
    server.use(
      http.get(`${API}/speech/results/`, ({ request }) => {
        polled.push(new URL(request.url).searchParams.get("uuid"));
        return HttpResponse.json(
          polled.length < 2
            ? { status: "processing" }
            : { status: "completed", result_url: "https://cdn.tts.ai/job-1/tts_output.mp3" },
        );
      }),
    );
    await reload(view);

    expect(queueRow(1).queryByText("Pending")).toBeNull();
    expect(screen.getByText(/1 file was still generating. The app is checking on that job again/)).not.toBeNull();
    expect(await queueRow(1).findByText("Completed", {}, { timeout: 5000 })).not.toBeNull();
    expect(await screen.findByText("1 file generated", {}, { timeout: 5000 })).not.toBeNull();
    expect(submits).toBe(1);
    expect(new Set(polled)).toEqual(new Set(["job-1"]));
  });

  it("keeps the speed a picked-up job was sent with", async () => {
    saveSession({
      items: [savedRow({ status: "processing", jobId: "job-1", speaker: PIPER })],
      draft: "",
      settings: { config: { mode: "single", singleSpeaker: PIPER, selectedVoices: [] }, globalSpeed: 1.5, languageChoice: null, voiceList: DEFAULT_VOICE_LIST },
      credits: { used: 0 },
    });
    server.use(
      http.get(`${API}/speech/results/`, () =>
        HttpResponse.json({ status: "completed", result_url: "https://cdn.tts.ai/job-1/tts_output.mp3" }),
      ),
    );
    const view = await openApp();
    await queueRow(1).findByText("Completed");
    view.unmount();

    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "{}") as { items: QueueItem[] };
    expect(saved.items[0]?.generatedWith).toEqual({ speaker: PIPER, speed: 1.5 });
  });

  it("restores completed rows with their download button", async () => {
    saveSession({
      items: [
        savedRow({
          status: "completed",
          jobId: "job-1",
          downloadUrl: "https://cdn.tts.ai/job-1/tts_output.mp3",
          generatedWith: { speaker: PIPER, speed: 1 },
        }),
      ],
      draft: "",
      settings: { config: { mode: "single", singleSpeaker: PIPER, selectedVoices: [] }, globalSpeed: 1, languageChoice: null, voiceList: DEFAULT_VOICE_LIST },
      credits: { used: 0 },
    });
    await openApp();
    expect(queueRow(1).getByText("Completed")).not.toBeNull();
    expect(queueRow(1).getByRole("button", { name: "Download" })).not.toBeNull();
  });

  it("starts with an empty queue when the saved data is unreadable", async () => {
    sessionStorage.setItem(SESSION_KEY, "{oops");
    await openApp();
    expect(screen.getByText(/Your queue is empty/)).not.toBeNull();
    expect(screen.queryByText("Queue restored")).toBeNull();
  });

  it("shows no restore message on a first visit", async () => {
    await openApp();
    expect(screen.queryByText("Queue restored")).toBeNull();
    await waitFor(() => expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull());
  });
});

describe("Reset", () => {
  const resetButton = () => screen.getByRole("button", { name: "Reset" });

  it("clears the queue and every setting after confirming, and a reload stays blank", async () => {
    const view = await openApp();
    addWords("un champ", "une rivière");
    fireEvent.change(screen.getByLabelText("Global speed"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByLabelText("Price, low to high"));
    fireEvent.click(screen.getByText("Round Robin"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    fireEvent.click(resetButton());

    expect(confirm).toHaveBeenCalledWith(
      "Start over? This resets every setting and removes all 2 files from the queue.",
    );
    expect(screen.getByText(/Your queue is empty/)).not.toBeNull();
    expect(screen.getByLabelText("Global speed")).toHaveProperty("value", "1");
    expect(screen.getByLabelText("Price, low to high")).toHaveProperty("checked", false);
    expect(screen.getByLabelText("Tested voices only")).toHaveProperty("checked", true);
    expect(screen.getByLabelText("Speaker for every file")).toHaveProperty("value", "");

    await reload(view);

    expect(screen.getByText(/Your queue is empty/)).not.toBeNull();
    expect(screen.queryByText("Queue restored")).toBeNull();
    expect(screen.getByLabelText("Global speed")).toHaveProperty("value", "1");
    expect(screen.getByLabelText("Price, low to high")).toHaveProperty("checked", false);
    expect(screen.getByLabelText("Tested voices only")).toHaveProperty("checked", true);
  });

  it("empties the Bulk Import box too, and says so before asking", async () => {
    const view = await openApp();
    addWords("un champ");
    fireEvent.change(screen.getByLabelText("Vocabulary list"), { target: { value: "une ferme" } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    fireEvent.click(resetButton());

    expect(confirm).toHaveBeenCalledWith(
      "Start over? This resets every setting and removes the 1 file in the queue and the text in Bulk Import.",
    );
    expect(screen.getByLabelText("Vocabulary list")).toHaveProperty("value", "");
    await reload(view);
    expect(screen.getByLabelText("Vocabulary list")).toHaveProperty("value", "");
  });

  it("mentions the Bulk Import text when the queue is empty", async () => {
    await openApp();
    fireEvent.change(screen.getByLabelText("Vocabulary list"), { target: { value: "une ferme" } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(resetButton());
    expect(confirm).toHaveBeenCalledWith("Start over? This resets every setting and removes the text in Bulk Import.");
    expect(screen.getByLabelText("Vocabulary list")).toHaveProperty("value", "une ferme");
  });

  it("clears the restore message too", async () => {
    const view = await openApp();
    addWords("un champ");
    await reload(view);
    expect(screen.getByText("Queue restored")).not.toBeNull();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    fireEvent.click(resetButton());

    expect(screen.queryByText("Queue restored")).toBeNull();
  });

  it("asks only about settings when the queue is already empty", async () => {
    await openApp();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(resetButton());
    expect(confirm).toHaveBeenCalledWith("Reset every setting to its default?");
  });

  it("changes nothing when cancelled", async () => {
    const view = await openApp();
    addWords("un champ");
    fireEvent.change(screen.getByLabelText("Global speed"), { target: { value: "1.5" } });
    vi.spyOn(window, "confirm").mockReturnValue(false);

    fireEvent.click(resetButton());

    expect(rowText(1)).toHaveProperty("value", "un champ");
    expect(screen.getByLabelText("Global speed")).toHaveProperty("value", "1.5");
    await reload(view);
    expect(rowText(1)).toHaveProperty("value", "un champ");
  });

  it("is disabled while audio is generating", async () => {
    await openApp();
    addWords("un champ");
    expect(resetButton()).toHaveProperty("disabled", false);
    await startGenerating();
    expect(resetButton()).toHaveProperty("disabled", true);
  });
});

describe("voice sorting", () => {
  it("groups every speaker list, including the queue rows, by price tier", async () => {
    await openApp();
    addWords("un champ");
    fireEvent.click(screen.getByText("Per File"));
    fireEvent.click(screen.getByLabelText("Price, low to high"));

    const picker = screen.getByLabelText("Speaker, row 1");
    expect([...picker.querySelectorAll("optgroup")].map((group) => group.label)).toEqual([
      "Free tier · 1 credit per character",
    ]);
    expect([...picker.querySelectorAll("optgroup option")].map((option) => option.textContent)).toEqual([
      "French (melotts)",
      "Siwis (piper)",
    ]);
  });
});

const FILE = "https://cdn.tts.ai/job-1/tts_output.mp3";

/** Saves a session as if a previous page had left it, with the speaker set to Siwis. */
function saveQueue(items: QueueItem[], changes: Partial<SessionSnapshot> = {}) {
  saveSession({
    items,
    draft: "",
    settings: { config: { mode: "single", singleSpeaker: PIPER, selectedVoices: [] }, globalSpeed: 1, languageChoice: null, voiceList: DEFAULT_VOICE_LIST },
    credits: { used: 0 },
    ...changes,
  });
}

const completedRow = savedRow({ status: "completed", jobId: "job-1", downloadUrl: FILE, generatedWith: { speaker: PIPER, speed: 1 } });

/** Serves FILE with `respond` and counts the downloads. */
function serveFile(respond: () => Response = () => new HttpResponse(new Uint8Array([0xff, 0xfb, 0x90]), { headers: { "Content-Type": "audio/mpeg" } })) {
  const counter = { downloads: 0 };
  server.use(
    http.get(FILE, () => {
      counter.downloads += 1;
      return respond();
    }),
  );
  return counter;
}

const credits = () => screen.getByText(/used this session/).textContent;

/** Stop shows while a clip is still loading, so wait for the clip to actually start. */
async function waitUntilPlaying(times = 1) {
  await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(times));
  await queueRow(1).findByRole("button", { name: "Stop" });
}

describe("credit counter", () => {
  function chargeEveryJob() {
    server.use(
      http.post(`${API}/tts/`, () => HttpResponse.json({ uuid: "job-1", status: "queued", credits_used: 11, credits_remaining: 5_000 })),
      http.get(`${API}/speech/results/`, () => HttpResponse.json({ status: "processing" })),
    );
  }

  it("starts at zero", async () => {
    await openApp();
    expect(credits()).toBe("0 credits used this session");
  });

  it("adds up the credits of every submitted job, shows TTS.ai's balance, and keeps both after a reload", async () => {
    const view = await openApp();
    addWords("un champ", "une rivière");
    chargeEveryJob();
    fireEvent.change(screen.getByLabelText("Speaker for every file"), { target: { value: PIPER } });
    fireEvent.click(screen.getByRole("button", { name: "Generate All" }));

    await waitFor(() => expect(credits()).toBe("22 credits used this session · TTS.ai reports 5,000 left"));
    await reload(view);
    expect(credits()).toBe("22 credits used this session · TTS.ai reports 5,000 left");
  });

  it("survives a reload, and Reset sets it back to zero", async () => {
    saveQueue([savedRow({})], { credits: { used: 319, reportedRemaining: 2_415_000 } });
    const view = await openApp();
    expect(credits()).toBe("319 credits used this session · TTS.ai reports 2,415,000 left");

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(credits()).toBe("0 credits used this session");

    await reload(view);
    expect(credits()).toBe("0 credits used this session");
  });
});

describe("audio preview", () => {
  it("plays a completed row, and Download then reuses the same file", async () => {
    const file = serveFile();
    saveQueue([completedRow]);
    await openApp();

    fireEvent.click(queueRow(1).getByRole("button", { name: "Play" }));
    await waitUntilPlaying();

    fireEvent.click(queueRow(1).getByRole("button", { name: "Download" }));
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1));
    expect(file.downloads).toBe(1);
  });

  it("goes back to Play when the clip is stopped", async () => {
    serveFile();
    saveQueue([completedRow]);
    await openApp();
    fireEvent.click(queueRow(1).getByRole("button", { name: "Play" }));
    await waitUntilPlaying();
    fireEvent.click(queueRow(1).getByRole("button", { name: "Stop" }));
    expect(queueRow(1).getByRole("button", { name: "Play" })).not.toBeNull();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it.each(["Play", "Download"])("fails the row with a way forward when %s finds the link expired", async (action) => {
    serveFile(() => HttpResponse.json({}, { status: 404 }));
    saveQueue([completedRow]);
    await openApp();

    fireEvent.click(queueRow(1).getByRole("button", { name: action }));

    expect(await queueRow(1).findByText("Failed")).not.toBeNull();
    expect(queueRow(1).getByText(EXPIRED_AUDIO_MESSAGE)).not.toBeNull();
    expect(screen.getByText(`Couldn't ${action.toLowerCase()} un_champ.mp3`)).not.toBeNull();
    expect(queueRow(1).queryByRole("button", { name: action })).toBeNull();
  });

  it("leaves the row alone when the file server refuses (403), which may be temporary", async () => {
    serveFile(() => HttpResponse.json({}, { status: 403 }));
    saveQueue([completedRow]);
    await openApp();

    fireEvent.click(queueRow(1).getByRole("button", { name: "Play" }));

    expect(await screen.findByText("Couldn't play un_champ.mp3")).not.toBeNull();
    expect(queueRow(1).getByText("Completed")).not.toBeNull();
    expect(queueRow(1).getByRole("button", { name: "Play" })).not.toBeNull();
  });

  it("marks files with expired links Failed when building the ZIP, and saves the rest", async () => {
    const other = "https://cdn.tts.ai/job-2/tts_output.mp3";
    serveFile();
    server.use(http.get(other, () => HttpResponse.json({}, { status: 410 })));
    saveQueue([completedRow, { ...completedRow, id: "row-2", text: "une rivière", filename: "une_riviere", downloadUrl: other }]);
    await openApp();

    fireEvent.click(screen.getByRole("button", { name: /Download All \(ZIP\)/ }));

    expect(await screen.findByText("vocabulary_audio.zip saved with 1 file")).not.toBeNull();
    expect(screen.getByText(/1 file had an expired audio link and is now marked Failed/)).not.toBeNull();
    expect(queueRow(2).getByText("Failed")).not.toBeNull();
    expect(queueRow(1).getByText("Completed")).not.toBeNull();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it("samples the voice a pending row will get, and counts the sample's credits", async () => {
    const submitted: unknown[] = [];
    server.use(
      http.post(`${API}/tts/`, async ({ request }) => {
        submitted.push(await request.json());
        return HttpResponse.json({ uuid: "sample-1", status: "queued", credits_used: 16 });
      }),
      http.get(`${API}/speech/results/`, () => HttpResponse.json({ status: "completed", result_url: FILE })),
    );
    serveFile();
    saveQueue([savedRow({})]);
    await openApp();

    fireEvent.click(queueRow(1).getByRole("button", { name: "Sample" }));

    await waitUntilPlaying();
    expect(submitted).toEqual([expect.objectContaining({ voice: "fr_FR-siwis-medium", model: "piper", speed: 1 })]);
    expect(credits()).toBe("16 credits used this session");
  });

  it("offers no sample in random mode, where the voice is picked at generation", async () => {
    saveQueue([savedRow({})]);
    await openApp();
    expect(queueRow(1).queryByRole("button", { name: "Sample" })).not.toBeNull();
    fireEvent.click(screen.getByText("Random Assignment"));
    expect(queueRow(1).queryByRole("button", { name: "Sample" })).toBeNull();
  });

  it("stops the clip when its row is removed", async () => {
    serveFile();
    saveQueue([completedRow]);
    await openApp();
    fireEvent.click(queueRow(1).getByRole("button", { name: "Play" }));
    await waitUntilPlaying();

    fireEvent.click(screen.getByRole("button", { name: "Remove row 1" }));

    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:clip");
  });
});

describe("typing in Bulk Import", () => {
  it("doesn't re-render the queue or the speaker lists", async () => {
    saveQueue([savedRow({ id: "a" }), savedRow({ id: "b", text: "une rivière" }), savedRow({ id: "c", text: "un village" })]);
    await openApp();
    vi.mocked(previewSpeaker).mockClear();
    vi.mocked(arrangeVoiceList).mockClear();

    for (const draft of ["u", "un", "une", "une f"]) {
      fireEvent.change(screen.getByLabelText("Vocabulary list"), { target: { value: draft } });
    }

    expect(screen.getByLabelText("Vocabulary list")).toHaveProperty("value", "une f");
    expect(previewSpeaker).not.toHaveBeenCalled();
    expect(arrangeVoiceList).not.toHaveBeenCalled();
  });
});

describe("Reset and voice samples", () => {
  it("forgets voice samples, so the next one is made again", async () => {
    let submits = 0;
    server.use(
      http.post(`${API}/tts/`, () => {
        submits += 1;
        return HttpResponse.json({ uuid: `sample-${submits}`, status: "queued", credits_used: 16 });
      }),
      http.get(`${API}/speech/results/`, () => HttpResponse.json({ status: "completed", result_url: FILE })),
    );
    serveFile();
    saveQueue([savedRow({})]);
    await openApp();
    fireEvent.click(queueRow(1).getByRole("button", { name: "Sample" }));
    await waitUntilPlaying();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    addWords("un champ");
    fireEvent.change(screen.getByLabelText("Speaker for every file"), { target: { value: PIPER } });
    fireEvent.click(queueRow(1).getByRole("button", { name: "Sample" }));

    await waitFor(() => expect(submits).toBe(2));
  });
});

describe("audio memory", () => {
  it("tells the audio cache which files rows still link to, so removed rows free theirs", async () => {
    const other = "https://cdn.tts.ai/job-2/tts_output.mp3";
    saveQueue([completedRow, { ...completedRow, id: "row-2", text: "une rivière", filename: "une_riviere", downloadUrl: other }]);
    await openApp();
    expect(vi.mocked(retainAudio).mock.lastCall?.[0]).toEqual(new Set([FILE, other]));

    fireEvent.click(screen.getByRole("button", { name: "Remove row 2" }));

    expect(vi.mocked(retainAudio).mock.lastCall?.[0]).toEqual(new Set([FILE]));
  });
});

describe("API key box", () => {
  it("uses the key a visitor enters, keeps it after a reload, and Reset leaves it alone", async () => {
    const auth: Array<string | null> = [];
    server.use(
      http.get(`${API}/voices/`, ({ request }) => {
        auth.push(request.headers.get("authorization"));
        return HttpResponse.json({ voices: [{ id: "fr_FR-siwis-medium", model: "piper", name: "Siwis", language: "fr" }] });
      }),
    );
    const view = render(<App />);
    await screen.findByText(/1 voice loaded/);
    expect(screen.getByText(/VITE_TTS_API_KEY/)).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Use my own key" }));
    fireEvent.change(screen.getByLabelText("TTS.ai API key"), { target: { value: "sk-visitor-1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    view.unmount();
    render(<App />);
    await screen.findByText(/1 voice loaded/);

    expect(auth).toEqual(["Bearer test-key", "Bearer sk-visitor-1234"]);
    expect(screen.getByText("••••1234")).not.toBeNull();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText("••••1234")).not.toBeNull();
  });

  it("goes back to the built-in key when the visitor's key is forgotten", async () => {
    await openApp();
    fireEvent.click(screen.getByRole("button", { name: "Use my own key" }));
    fireEvent.change(screen.getByLabelText("TTS.ai API key"), { target: { value: "sk-visitor-1234" } });
    fireEvent.click(screen.getByLabelText("Remember on this device"));
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    expect(screen.getByText(/remembered on this device/)).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Forget" }));

    expect(screen.getByText(/VITE_TTS_API_KEY/)).not.toBeNull();
    expect(localStorage.length).toBe(0);
  });
});

describe("hidden voices", () => {
  it("leaves voices that failed the French check out of every list and the count", async () => {
    server.use(
      http.get(`${API}/voices/`, () =>
        HttpResponse.json({
          voices: [
            { id: "fr_FR-siwis-medium", model: "piper", name: "Siwis", language: "fr" },
            { id: "v2/fr_speaker_0", model: "bark", name: "French Speaker 1", language: "fr" },
            { id: "jean_fr", model: "pocket-tts", name: "Jean (French)", language: "fr" },
            { id: "fantine_fr", model: "pocket-tts", name: "Fantine (French)", language: "fr" },
          ],
        }),
      ),
    );
    render(<App />);
    await screen.findByText(/2 voices loaded/);

    const picker = screen.getByLabelText("Speaker for every file");
    const options = [...picker.querySelectorAll("option")].map((option) => option.textContent);
    expect(options).toEqual(["Choose a speaker…", "Fantine (French) (pocket-tts) · ignores speed", "Siwis (piper)"]);
  });
});

describe("Follows speed sorting", () => {
  it("lists only voices known to follow the speed setting in every picker", async () => {
    server.use(
      http.get(`${API}/voices/`, () =>
        HttpResponse.json({
          voices: [
            { id: "fr_FR-siwis-medium", model: "piper", name: "Siwis (French)", language: "fr" },
            { id: "FR", model: "openvoice", name: "French", language: "fr" },
            { id: "ff_siwis", model: "kokoro", name: "Siwis", language: "fr" },
          ],
        }),
      ),
    );
    render(<App />);
    await screen.findByText(/3 voices loaded/);

    fireEvent.click(screen.getByLabelText("Responds to speed control"));
    fireEvent.click(screen.getByLabelText("Price, low to high"));

    const picker = screen.getByLabelText("Speaker for every file");
    expect([...picker.querySelectorAll("optgroup")].map((group) => [group.label, [...group.querySelectorAll("option")].map((o) => o.textContent)])).toEqual([
      ["Free tier · 1 credit per character", ["Siwis (kokoro)", "Siwis (French) (piper)"]],
    ]);
  });
});

describe("Sort voices checkboxes", () => {
  beforeEach(() => {
    server.use(
      http.get(`${API}/voices/`, () =>
        HttpResponse.json({
          voices: [
            { id: "fr_FR-siwis-medium", model: "piper", name: "Siwis", language: "fr" },
            { id: "fr_test", model: "xtts", name: "Xavier", language: "fr" },
            { id: "FR", model: "melotts", name: "French", language: "fr" },
            { id: "v2/en_speaker_0", model: "bark", name: "English Male 1", language: "en" },
          ],
        }),
      ),
    );
  });

  const pickerOptions = () =>
    [...screen.getByLabelText("Speaker for every file").querySelectorAll("option")].map((option) => option.textContent);

  it("starts with tested voices only, A–Z, and Reset brings that back", async () => {
    render(<App />);
    await screen.findByText(/4 voices loaded/);
    expect(pickerOptions()).toEqual(["Choose a speaker…", "French (melotts)", "Siwis (piper)"]);

    fireEvent.click(screen.getByLabelText("Tested voices only"));
    expect(pickerOptions()).toEqual(["Choose a speaker…", "French (melotts)", "Siwis (piper)", "Xavier (xtts)"]);
    fireEvent.click(screen.getByLabelText("By name (A–Z)"));
    expect(pickerOptions()).toEqual(["Choose a speaker…", "Siwis (piper)", "Xavier (xtts)", "French (melotts)"]);

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByLabelText("Tested voices only")).toHaveProperty("checked", true);
    expect(screen.getByLabelText("By name (A–Z)")).toHaveProperty("checked", true);
    expect(pickerOptions()).toEqual(["Choose a speaker…", "French (melotts)", "Siwis (piper)"]);
  });

  it("explains an empty list when the language has no tested voices", async () => {
    render(<App />);
    await screen.findByText(/4 voices loaded/);
    fireEvent.change(screen.getByLabelText("Voice language"), { target: { value: "en" } });
    expect(pickerOptions()).toEqual([
      "Choose a speaker…",
      "No tested voices here. Only French voices have been tested so far.",
    ]);
  });
});

describe("review fixes, through the whole app", () => {
  beforeEach(() => {
    server.use(
      http.get(`${API}/voices/`, () =>
        HttpResponse.json({
          voices: [
            { id: "fr_FR-siwis-medium", model: "piper", name: "Siwis", language: "fr" },
            { id: "FR", model: "openvoice", name: "French", language: "fr" },
            { id: "v2/en_speaker_0", model: "bark", name: "English Male 1", language: "en" },
          ],
        }),
      ),
    );
  });

  it("keeps a picked voice that a box now hides in the pool, so it can be unticked", async () => {
    render(<App />);
    await screen.findByText(/3 voices loaded/);
    fireEvent.click(screen.getByText("Random Assignment"));
    fireEvent.click(within(screen.getByRole("group", { name: "Voice pool" })).getByLabelText(/French \(openvoice\)/));
    expect(screen.getByText("(1 selected)")).not.toBeNull();

    fireEvent.click(screen.getByLabelText("Responds to speed control"));

    const hidden = screen.getByRole("list", { name: "Selected, but hidden by the language or Sort voices" });
    const box = within(hidden).getByRole("checkbox");
    expect(box).toHaveProperty("checked", true);
    fireEvent.click(box);
    expect(screen.getByText("(0 selected)")).not.toBeNull();
    expect(screen.queryByRole("list", { name: "Selected, but hidden by the language or Sort voices" })).toBeNull();
  });

  it("restores an old session that used a now-hidden voice without blocking anything", async () => {
    const bark = "bark:v2/fr_speaker_0";
    saveQueue(
      [
        savedRow({ id: "done", status: "completed", speaker: bark, jobId: "job-1", downloadUrl: FILE, generatedWith: { speaker: bark, speed: 1 } }),
        savedRow({ id: "next", text: "une rivière", filename: "une_riviere" }),
      ],
      { settings: { config: { mode: "roundRobin", selectedVoices: [bark, PIPER] }, globalSpeed: 1, languageChoice: null, voiceList: DEFAULT_VOICE_LIST } },
    );
    render(<App />);
    await screen.findByText(/3 voices loaded/);

    const order = screen.getByText("Speaking order").parentElement as HTMLElement;
    expect(within(order).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual([expect.stringContaining("Siwis")]);
    expect(queueRow(1).getByText("French Speaker 1")).not.toBeNull();
    expect(screen.getByText("(1 selected)")).not.toBeNull();
  });

  it("counts each language by what the Sort voices boxes let through", async () => {
    render(<App />);
    await screen.findByText(/3 voices loaded/);
    const options = [...screen.getByLabelText("Voice language").querySelectorAll("option")].map((option) => option.textContent);
    expect(options).toEqual(["All languages (2 of 3)", "English (0 of 1)", "French (2)"]);
    fireEvent.click(screen.getByLabelText("Tested voices only"));
    expect([...screen.getByLabelText("Voice language").querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "All languages (3)",
      "English (1)",
      "French (2)",
    ]);
  });
});
