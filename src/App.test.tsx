// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { EXPIRED_AUDIO_MESSAGE, clearAudioCache } from "./services/audio";
import { SESSION_KEY, saveSession, type SessionSnapshot } from "./services/session";
import { clearVoiceSamples } from "./services/voiceSample";
import { server } from "./test/server";
import type { QueueItem } from "./types/queue";

const API = `${import.meta.env.VITE_TTS_API_ORIGIN}/v1`;
const PIPER = "piper:fr_FR-siwis-medium";

beforeEach(() => {
  sessionStorage.clear();
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
    fireEvent.change(screen.getByLabelText("Sort voices"), { target: { value: "tier" } });
    fireEvent.change(screen.getByLabelText("Speaker for every file"), { target: { value: PIPER } });

    await reload(view);

    expect(rowText(1)).toHaveProperty("value", "un champ");
    expect(rowText(2)).toHaveProperty("value", "une rivière");
    expect(screen.getByLabelText("Global speed")).toHaveProperty("value", "1.5");
    expect(screen.getByLabelText("Sort voices")).toHaveProperty("value", "tier");
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

  it("puts a row that was generating back to Pending after a reload", async () => {
    const view = await openApp();
    addWords("un champ");
    await startGenerating();

    await reload(view);

    expect(queueRow(1).getByText("Pending")).not.toBeNull();
    expect(queueRow(1).queryByText("Queued")).toBeNull();
    expect(screen.getByText(/1 file that was still generating is back to Pending/)).not.toBeNull();
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
      settings: { config: { mode: "single", singleSpeaker: PIPER, selectedVoices: [] }, globalSpeed: 1, languageChoice: null, voiceOrder: "name" },
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
    fireEvent.change(screen.getByLabelText("Sort voices"), { target: { value: "tier" } });
    fireEvent.click(screen.getByText("Round Robin"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    fireEvent.click(resetButton());

    expect(confirm).toHaveBeenCalledWith(
      "Start over? This resets every setting and removes all 2 files from the queue.",
    );
    expect(screen.getByText(/Your queue is empty/)).not.toBeNull();
    expect(screen.getByLabelText("Global speed")).toHaveProperty("value", "1");
    expect(screen.getByLabelText("Sort voices")).toHaveProperty("value", "name");
    expect(screen.getByLabelText("Speaker for every file")).toHaveProperty("value", "");

    await reload(view);

    expect(screen.getByText(/Your queue is empty/)).not.toBeNull();
    expect(screen.queryByText("Queue restored")).toBeNull();
    expect(screen.getByLabelText("Global speed")).toHaveProperty("value", "1");
    expect(screen.getByLabelText("Sort voices")).toHaveProperty("value", "name");
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
    fireEvent.change(screen.getByLabelText("Sort voices"), { target: { value: "tier" } });

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
    settings: { config: { mode: "single", singleSpeaker: PIPER, selectedVoices: [] }, globalSpeed: 1, languageChoice: null, voiceOrder: "name" },
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
