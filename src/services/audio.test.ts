import { http, HttpResponse } from "msw/http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import { wavBlob, wavFile } from "../test/wav";
import { clearAudioCache, isExpiredAudioError, isWav, loadAudio, retainAudio, toMp3 } from "./audio";
import { TtsApiError } from "./ttsApi";

// Retries happen instantly.
vi.mock("../utils/wait", () => ({ wait: vi.fn(() => Promise.resolve()) }));

const FILE = "https://cdn.tts.ai/job-1/tts_output.mp3";
const mp3 = () => new HttpResponse(new Uint8Array([0xff, 0xfb, 0x90]), { headers: { "Content-Type": "audio/mpeg" } });

/** Serves `url` with each response in turn (repeating the last) and counts the requests. */
function serve(url: string, ...responses: Array<() => Response>) {
  const counter = { calls: 0 };
  server.use(
    http.get(url, () => {
      const respond = responses[Math.min(counter.calls, responses.length - 1)] ?? mp3;
      counter.calls += 1;
      return respond();
    }),
  );
  return counter;
}

beforeEach(() => {
  clearAudioCache();
});



describe("loadAudio", () => {
  it("fetches a file once and reuses it", async () => {
    const counter = serve(FILE, mp3);
    const first = await loadAudio(FILE);
    const second = await loadAudio(FILE);
    expect(first.size).toBe(3);
    expect(second).toBe(first);
    expect(counter.calls).toBe(1);
  });

  it("shares one request between loads that overlap", async () => {
    const counter = serve(FILE, mp3);
    const [first, second] = await Promise.all([loadAudio(FILE), loadAudio(FILE)]);
    expect(second).toBe(first);
    expect(counter.calls).toBe(1);
  });

  it("keeps each URL separately", async () => {
    const other = "https://cdn.tts.ai/job-2/tts_output.mp3";
    const firstCounter = serve(FILE, mp3);
    const otherCounter = serve(other, mp3);
    expect(await loadAudio(FILE)).not.toBe(await loadAudio(other));
    expect([firstCounter.calls, otherCounter.calls]).toEqual([1, 1]);
  });

  it("doesn't keep failures, so trying again refetches", async () => {
    const counter = serve(FILE, () => HttpResponse.json({}, { status: 404 }), mp3);
    await expect(loadAudio(FILE)).rejects.toMatchObject({ status: 404 });
    await expect(loadAudio(FILE)).resolves.toHaveProperty("size", 3);
    expect(counter.calls).toBe(2);
  });

  it("refetches after the cache is cleared", async () => {
    const counter = serve(FILE, mp3);
    await loadAudio(FILE);
    clearAudioCache();
    await loadAudio(FILE);
    expect(counter.calls).toBe(2);
  });
});

describe("retainAudio", () => {
  it("forgets every file except the ones still in use", async () => {
    const other = "https://cdn.tts.ai/job-2/tts_output.mp3";
    const kept = serve(FILE, mp3);
    const dropped = serve(other, mp3);
    await Promise.all([loadAudio(FILE), loadAudio(other)]);

    retainAudio(new Set([FILE]));
    await Promise.all([loadAudio(FILE), loadAudio(other)]);

    expect(kept.calls).toBe(1);
    expect(dropped.calls).toBe(2);
  });
});

describe("isExpiredAudioError", () => {
  it.each([404, 410])("treats HTTP %d as an expired link", (status) => {
    expect(isExpiredAudioError(new TtsApiError("request", "Gone", undefined, status))).toBe(true);
  });

  it("doesn't treat other failures as expired, including a 403 that may be temporary", () => {
    expect(isExpiredAudioError(new TtsApiError("request", "Refused", undefined, 403))).toBe(false);
    expect(isExpiredAudioError(new TtsApiError("server", "Down", undefined, 500))).toBe(false);
    expect(isExpiredAudioError(new TtsApiError("network", "Offline"))).toBe(false);
    expect(isExpiredAudioError(new Error("Something else"))).toBe(false);
  });

  it("recognizes a real expired download", async () => {
    serve(FILE, () => HttpResponse.json({}, { status: 410 }));
    const error = await loadAudio(FILE).catch((caught: unknown) => caught);
    expect(isExpiredAudioError(error)).toBe(true);
  });
});

describe("WAV to MP3", () => {
  const mp3Head = async (audio: Blob) => [...new Uint8Array(await audio.slice(0, 2).arrayBuffer())];

  it("tells WAV from MP3 by the file's first bytes", async () => {
    expect(await isWav(wavBlob())).toBe(true);
    expect(await isWav(new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00])]))).toBe(false);
    expect(await isWav(new Blob([new TextEncoder().encode("ID3")]))).toBe(false);
    expect(await isWav(new Blob([]))).toBe(false);
  });

  it("leaves MP3 alone", async () => {
    const mp3 = new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00])], { type: "audio/mpeg" });
    expect(await toMp3(mp3)).toBe(mp3);
  });

  it("converts WAV to real MP3 on the page when there are no workers, as in these tests", async () => {
    expect(typeof Worker).toBe("undefined");
    const converted = await toMp3(wavBlob({ type: "audio/mpeg" }));
    expect(converted.type).toBe("audio/mpeg");
    expect(await isWav(converted)).toBe(false);
    const [first = 0, second = 0] = await mp3Head(converted);
    expect(first).toBe(0xff);
    expect(second & 0xe0).toBe(0xe0);
  });

  it("keeps the WAV when it can't be converted, rather than losing the audio", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const odd = wavBlob({ bits: 8 });
    expect(await toMp3(odd)).toBe(odd);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("keeps the audio when even checking its type fails, as in browsers without Blob.arrayBuffer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const audio = new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00])], { type: "audio/mpeg" });
    vi.spyOn(audio, "slice").mockImplementation(() => {
      throw new TypeError("arrayBuffer is not a function");
    });
    expect(await toMp3(audio)).toBe(audio);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("converts WAV downloads once, and keeps the MP3", async () => {
    const counter = serve(FILE, () => new HttpResponse(wavFile({ samples: Array.from({ length: 4410 }, (_, i) => (i % 50) * 200) }), {
      headers: { "Content-Type": "audio/mpeg" },
    }));
    const first = await loadAudio(FILE);
    const second = await loadAudio(FILE);
    expect(await isWav(first)).toBe(false);
    expect(first.type).toBe("audio/mpeg");
    expect(second).toBe(first);
    expect(counter.calls).toBe(1);
  });
});

/**
 * Stands in for the browser's Worker: answers like mp3Worker.ts, converting on this thread, or
 * fails to load like a worker an old browser can't start.
 */
class FakeWorker {
  static created: FakeWorker[] = [];
  static failToLoad = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string; preventDefault: () => void }) => void) | null = null;
  readonly url: string;
  readonly messages: Array<{ id: number; wav: ArrayBuffer }> = [];
  terminated = false;

  constructor(url: URL | string) {
    this.url = String(url);
    FakeWorker.created.push(this);
  }

  postMessage(message: { id: number; wav: ArrayBuffer }) {
    this.messages.push(message);
    setTimeout(async () => {
      if (FakeWorker.failToLoad) {
        this.onerror?.({ message: "Module workers aren't supported.", preventDefault: () => undefined });
        return;
      }
      const { wavToMp3 } = await import("./wavToMp3");
      try {
        const mp3 = await (await wavToMp3(new Blob([message.wav]))).arrayBuffer();
        this.onmessage?.({ data: { id: message.id, mp3 } });
      } catch (error) {
        this.onmessage?.({ data: { id: message.id, error: (error as Error).message } });
      }
    });
  }

  terminate() {
    this.terminated = true;
  }
}

describe("WAV to MP3 in a worker", () => {
  beforeEach(() => {
    vi.resetModules();
    FakeWorker.created = [];
    FakeWorker.failToLoad = false;
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("converts in the worker, matching each reply to its file", async () => {
    const { isWav: isWavFresh, toMp3: toMp3Fresh } = await import("./audio");
    const [one, two] = await Promise.all([toMp3Fresh(wavBlob()), toMp3Fresh(wavBlob({ seconds: 0.5 }))]);
    expect(FakeWorker.created).toHaveLength(1);
    expect(FakeWorker.created[0]?.url).toMatch(/mp3Worker\.ts$/);
    expect(FakeWorker.created[0]?.messages.map((message) => message.id)).toEqual([1, 2]);
    expect(await isWavFresh(one as Blob)).toBe(false);
    expect((two as Blob).size).toBeGreaterThan((one as Blob).size);
  });

  it("falls back to converting on the page when the worker can't load, and stops using it", async () => {
    FakeWorker.failToLoad = true;
    const { isWav: isWavFresh, toMp3: toMp3Fresh } = await import("./audio");
    const converted = await toMp3Fresh(wavBlob());
    expect(await isWavFresh(converted)).toBe(false);
    expect(FakeWorker.created[0]?.terminated).toBe(true);
    await toMp3Fresh(wavBlob());
    expect(FakeWorker.created).toHaveLength(1);
    expect(FakeWorker.created[0]?.messages).toHaveLength(1);
  });

  it("keeps the WAV when neither the worker nor the page can convert it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { toMp3: toMp3Fresh } = await import("./audio");
    const odd = wavBlob({ bits: 8 });
    expect(await toMp3Fresh(odd)).toBe(odd);
    warn.mockRestore();
  });
});
