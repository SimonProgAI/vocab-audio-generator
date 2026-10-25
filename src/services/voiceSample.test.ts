import { http, HttpResponse } from "msw/http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import type { Voice } from "../types/queue";
import { wait } from "../utils/wait";
import { clearAudioCache } from "./audio";
import { SAMPLE_TEXT, clearVoiceSamples, loadVoiceSample } from "./voiceSample";

// Polls and retries happen instantly.
vi.mock("../utils/wait", () => ({ wait: vi.fn(() => Promise.resolve()) }));

const API = `${import.meta.env.VITE_TTS_API_ORIGIN}/v1`;
const SAMPLE_URL = "https://cdn.tts.ai/sample-1/tts_output.mp3";
const siwis: Voice = { key: "piper:fr_FR-siwis-medium", id: "fr_FR-siwis-medium", name: "Siwis", language: "fr-FR", model: "piper" };
const melo: Voice = { key: "melotts:FR", id: "FR", name: "French", language: "fr", model: "melotts" };

/** A TTS.ai that accepts sample jobs and answers status polls with `statuses` in turn. */
function fakeTtsAi(...statuses: object[]) {
  const submitted: unknown[] = [];
  const polledJobs: Array<string | null> = [];
  let polls = 0;
  server.use(
    http.post(`${API}/tts/`, async ({ request }) => {
      submitted.push(await request.json());
      return HttpResponse.json({ uuid: `sample-${submitted.length}`, status: "queued", credits_used: 16, credits_remaining: 1000 });
    }),
    http.get(`${API}/speech/results/`, ({ request }) => {
      polledJobs.push(new URL(request.url).searchParams.get("uuid"));
      const reply = statuses[Math.min(polls, statuses.length - 1)] ?? {};
      polls += 1;
      return HttpResponse.json(reply);
    }),
    http.get(SAMPLE_URL, () => new HttpResponse(new Uint8Array([0xff, 0xfb, 0x90]), { headers: { "Content-Type": "audio/mpeg" } })),
  );
  return { submitted, polledJobs, polls: () => polls };
}

const DONE = { status: "completed", result_url: SAMPLE_URL };

beforeEach(() => {
  clearVoiceSamples();
  clearAudioCache();
});

describe("loadVoiceSample", () => {
  it("has the voice say the sample phrase at normal speed, waits for it, and returns the audio", async () => {
    const tts = fakeTtsAi({ status: "processing" }, DONE);
    const onSubmitted = vi.fn();

    const audio = await loadVoiceSample(siwis, { onSubmitted });

    expect(audio.size).toBe(3);
    expect(tts.submitted).toEqual([
      { text: SAMPLE_TEXT, voice: "fr_FR-siwis-medium", model: "piper", speed: 1, format: "mp3", language: "fr" },
    ]);
    expect(onSubmitted).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ jobId: "sample-1", creditsUsed: 16, creditsRemaining: 1000 }),
    );
    expect(tts.polls()).toBe(2);
  });

  it("makes each voice's sample only once per session", async () => {
    const tts = fakeTtsAi(DONE);
    const onSubmitted = vi.fn();
    const first = await loadVoiceSample(siwis, { onSubmitted });
    const second = await loadVoiceSample(siwis, { onSubmitted });
    expect(second).toBe(first);
    expect(tts.submitted).toHaveLength(1);
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  it("makes a separate sample for another voice", async () => {
    const tts = fakeTtsAi(DONE);
    await loadVoiceSample(siwis);
    await loadVoiceSample(melo);
    expect(tts.submitted.map((body) => (body as { model: string }).model)).toEqual(["piper", "melotts"]);
  });

  it("passes on TTS.ai's failure message, and tries again next time", async () => {
    const tts = fakeTtsAi({ status: "failed", error: "Voice crashed" });
    await expect(loadVoiceSample(siwis)).rejects.toThrow("Voice crashed");
    await expect(loadVoiceSample(siwis)).rejects.toThrow("Voice crashed");
    expect(tts.submitted).toHaveLength(2);
  });

  it("gives up after about 3 minutes of waiting", async () => {
    const tts = fakeTtsAi({ status: "processing" });
    await expect(loadVoiceSample(siwis)).rejects.toThrow("Siwis took too long to make a sample. Try again later.");
    expect(tts.polls()).toBe(120);
  });

  it("fails right away when TTS.ai rejects the sample job", async () => {
    server.use(http.post(`${API}/tts/`, () => HttpResponse.json({ uuid: "sample-1", status: "failed" })));
    await expect(loadVoiceSample(siwis)).rejects.toThrow("TTS.ai couldn't make a sample of Siwis.");
  });
});

describe("stopping a sample", () => {
  it("stops checking on the job, and a later request checks on the same job without paying again", async () => {
    const tts = fakeTtsAi({ status: "processing" });
    const controller = new AbortController();
    vi.mocked(wait).mockImplementationOnce(async () => {
      controller.abort();
    });

    await expect(loadVoiceSample(siwis, { signal: controller.signal })).rejects.toMatchObject({ kind: "aborted" });
    expect(tts.polls()).toBe(1);

    fakeTtsAi(DONE);
    const onSubmitted = vi.fn();
    await expect(loadVoiceSample(siwis, { onSubmitted })).resolves.toHaveProperty("size", 3);
    expect(tts.submitted).toHaveLength(1);
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("checks on the remembered job by its ID", async () => {
    const tts = fakeTtsAi({ status: "processing" });
    const controller = new AbortController();
    vi.mocked(wait).mockImplementationOnce(async () => {
      controller.abort();
    });
    await loadVoiceSample(siwis, { signal: controller.signal }).catch(() => undefined);

    const again = fakeTtsAi(DONE);
    await loadVoiceSample(siwis);
    expect([...tts.polledJobs, ...again.polledJobs]).toEqual(["sample-1", "sample-1"]);
  });

  it("forgets unfinished jobs when samples are cleared, as Reset does", async () => {
    const tts = fakeTtsAi({ status: "processing" });
    const controller = new AbortController();
    vi.mocked(wait).mockImplementationOnce(async () => {
      controller.abort();
    });
    await loadVoiceSample(siwis, { signal: controller.signal }).catch(() => undefined);

    clearVoiceSamples();
    const again = fakeTtsAi(DONE);
    await loadVoiceSample(siwis);
    expect(tts.submitted.length + again.submitted.length).toBe(2);
  });
});
