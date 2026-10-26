import { http, HttpResponse } from "msw/http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
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

/** A small mono 16-bit WAV, like piper sends; `bits: 8` makes one the converter can't read. */
function wavBytes({ seconds = 0.2, bits = 16 }: { seconds?: number; bits?: number } = {}): Uint8Array<ArrayBuffer> {
  const rate = 22050;
  const count = Math.round(rate * seconds);
  const bytesPerSample = bits / 8;
  const buffer = new ArrayBuffer(44 + count * bytesPerSample);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, bits, true);
  text(36, "data");
  view.setUint32(40, count * bytesPerSample, true);
  for (let i = 0; i < count && bits === 16; i += 1) view.setInt16(44 + i * 2, Math.round(Math.sin(i / 8) * 8000), true);
  return new Uint8Array(buffer);
}


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
    expect(await isWav(new Blob([wavBytes()]))).toBe(true);
    expect(await isWav(new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00])]))).toBe(false);
    expect(await isWav(new Blob([new TextEncoder().encode("ID3")]))).toBe(false);
    expect(await isWav(new Blob([]))).toBe(false);
  });

  it("leaves MP3 alone", async () => {
    const mp3 = new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00])], { type: "audio/mpeg" });
    expect(await toMp3(mp3)).toBe(mp3);
  });

  it("converts WAV to real MP3", async () => {
    const converted = await toMp3(new Blob([wavBytes()], { type: "audio/mpeg" }));
    expect(converted.type).toBe("audio/mpeg");
    expect(await isWav(converted)).toBe(false);
    const [first = 0, second = 0] = await mp3Head(converted);
    expect(first).toBe(0xff);
    expect(second & 0xe0).toBe(0xe0);
  });

  it("keeps the WAV when it can't be converted, rather than losing the audio", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const odd = new Blob([wavBytes({ bits: 8 })]);
    expect(await toMp3(odd)).toBe(odd);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("converts WAV downloads once, and keeps the MP3", async () => {
    const counter = serve(FILE, () => new HttpResponse(wavBytes(), { headers: { "Content-Type": "audio/mpeg" } }));
    const first = await loadAudio(FILE);
    const second = await loadAudio(FILE);
    expect(await isWav(first)).toBe(false);
    expect(first.type).toBe("audio/mpeg");
    expect(second).toBe(first);
    expect(counter.calls).toBe(1);
  });
});
