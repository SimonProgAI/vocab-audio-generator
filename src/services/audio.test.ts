import { http, HttpResponse } from "msw/http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import { clearAudioCache, isExpiredAudioError, loadAudio } from "./audio";
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

describe("isExpiredAudioError", () => {
  it.each([403, 404, 410])("treats HTTP %d as an expired link", (status) => {
    expect(isExpiredAudioError(new TtsApiError("request", "Gone", undefined, status))).toBe(true);
  });

  it("doesn't treat other failures as expired", () => {
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
