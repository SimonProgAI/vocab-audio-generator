// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueItem } from "../types/queue";
import { clearAudioCache, loadAudio } from "./audio";
import { downloadAllCompleted, downloadItem, isDownloadable, toMp3Name } from "./download";
import { TtsApiError, downloadAudio } from "./ttsApi";

vi.mock("./ttsApi", async (importOriginal) => ({ ...(await importOriginal<object>()), downloadAudio: vi.fn() }));

const audio = new Blob([new Uint8Array([0xff, 0xfb, 0x90])], { type: "audio/mpeg" });

const completed: QueueItem = {
  id: "row-1",
  text: "une rivière",
  filename: "une_riviere",
  autoFilename: true,
  speed: 1,
  overrideSpeed: false,
  status: "completed",
  downloadUrl: "https://api.tts.ai/files/une_riviere.mp3",
};

describe("toMp3Name", () => {
  it.each([
    ["une_riviere", "une_riviere.mp3"],
    ["une_riviere.mp3", "une_riviere.mp3"],
    ["Bonjour.MP3", "Bonjour.mp3"],
    ["  bonjour  ", "bonjour.mp3"],
    ["..cache..", "cache.mp3"],
    ["...", "audio.mp3"],
    ["", "audio.mp3"],
  ])("%j → %j", (filename, expected) => {
    expect(toMp3Name(filename)).toBe(expected);
  });
});

describe("isDownloadable", () => {
  it("needs a completed row with an audio URL", () => {
    expect(isDownloadable(completed)).toBe(true);
    expect(isDownloadable({ ...completed, downloadUrl: undefined })).toBe(false);
    expect(isDownloadable({ ...completed, status: "processing" })).toBe(false);
  });
});

describe("downloadItem", () => {
  let saved: Array<{ href: string | null; download: string; attached: boolean }>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(downloadAudio).mockReset();
    clearAudioCache();
    // jsdom has no object URLs, and clicking a link would try to navigate.
    URL.createObjectURL = vi.fn(() => "blob:audio");
    URL.revokeObjectURL = vi.fn();
    saved = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ href: this.getAttribute("href"), download: this.download, attached: this.isConnected });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fetches the row's audio and saves it under its .mp3 name", async () => {
    vi.mocked(downloadAudio).mockResolvedValue(audio);
    await downloadItem(completed);

    expect(downloadAudio).toHaveBeenCalledWith("https://api.tts.ai/files/une_riviere.mp3");
    expect(URL.createObjectURL).toHaveBeenCalledWith(audio);
    expect(saved).toEqual([{ href: "blob:audio", download: "une_riviere.mp3", attached: true }]);
    expect(document.querySelectorAll("a")).toHaveLength(0);
  });

  it("reuses audio that was already loaded, such as by Play, instead of fetching it again", async () => {
    vi.mocked(downloadAudio).mockResolvedValue(audio);
    await loadAudio("https://api.tts.ai/files/une_riviere.mp3");
    await downloadItem(completed);

    expect(downloadAudio).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledWith(audio);
  });

  it("revokes the object URL a minute later, once the browser has started the download", async () => {
    vi.mocked(downloadAudio).mockResolvedValue(audio);
    await downloadItem(completed);

    vi.advanceTimersByTime(59_999);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:audio");
  });

  it("refuses rows that aren't ready, without fetching anything", async () => {
    await expect(downloadItem({ ...completed, status: "pending" })).rejects.toThrow(
      "This file isn't ready to download yet.",
    );
    expect(downloadAudio).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it("passes download errors on and saves nothing", async () => {
    const error = new Error("Couldn't reach TTS.ai.");
    vi.mocked(downloadAudio).mockRejectedValue(error);

    await expect(downloadItem(completed)).rejects.toBe(error);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });
});

describe("downloadAllCompleted", () => {
  const second: QueueItem = { ...completed, id: "row-2", filename: "un_champ", downloadUrl: "https://cdn.tts.ai/job-2/tts_output.mp3" };
  const gone = new TtsApiError("request", "Not found", undefined, 404);

  beforeEach(() => {
    vi.mocked(downloadAudio).mockReset();
    clearAudioCache();
    URL.createObjectURL = vi.fn(() => "blob:zip");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves the files it could fetch and reports the expired ones", async () => {
    vi.mocked(downloadAudio).mockImplementation((url) => (url === second.downloadUrl ? Promise.reject(gone) : Promise.resolve(audio)));

    const result = await downloadAllCompleted([completed, second]);

    expect(result).toEqual({
      added: 1,
      skipped: ["un_champ.mp3"],
      expired: [{ id: "row-2", url: "https://cdn.tts.ai/job-2/tts_output.mp3" }],
    });
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it("doesn't call other failures expired", async () => {
    vi.mocked(downloadAudio).mockImplementation((url) =>
      url === second.downloadUrl ? Promise.reject(new TtsApiError("network", "Offline")) : Promise.resolve(audio),
    );
    await expect(downloadAllCompleted([completed, second])).resolves.toMatchObject({ added: 1, expired: [] });
  });

  it("saves nothing when no file could be fetched, but still reports the expired ones", async () => {
    vi.mocked(downloadAudio).mockRejectedValue(gone);

    const result = await downloadAllCompleted([completed, second]);

    expect(result.added).toBe(0);
    expect(result.expired.map((entry) => entry.id)).toEqual(["row-1", "row-2"]);
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });
});
