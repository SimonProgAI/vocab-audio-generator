import { http, HttpResponse } from "msw/http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import type { Voice } from "../types/queue";
import { wait } from "../utils/wait";
import { forgetApiKey, saveApiKey } from "./apiKey";
import { downloadAudio, getJobStatus, getVoices, submitJob } from "./ttsApi";

// Retries happen instantly; the delays they asked for are still recorded on the mock.
vi.mock("../utils/wait", () => ({ wait: vi.fn(() => Promise.resolve()) }));

const ORIGIN = import.meta.env.VITE_TTS_API_ORIGIN;
const API = `${ORIGIN}/v1`;

const voice: Voice = { key: "melotts:FR", id: "FR", name: "French", language: "fr-FR", model: "melotts" };

/** Replies with each response in turn (repeating the last one) and counts the calls. */
function sequence(method: "get" | "post", url: string, ...responses: Array<() => Response>) {
  const counter = { calls: 0 };
  server.use(
    http[method](url, () => {
      const respond = responses[Math.min(counter.calls, responses.length - 1)];
      counter.calls += 1;
      if (!respond) throw new Error("sequence() needs at least one response.");
      return respond();
    }),
  );
  return counter;
}

const status = (code: number, body: object = {}, headers: Record<string, string> = {}) => () =>
  HttpResponse.json(body, { status: code, headers });

function waitedMs(): number[] {
  return vi.mocked(wait).mock.calls.map(([ms]) => ms);
}

beforeEach(() => {
  vi.mocked(wait).mockClear();
});

describe("getVoices", () => {
  it("sends the test key, never the one from .env", async () => {
    let authorization: string | null = null;
    server.use(
      http.get(`${API}/voices/`, ({ request }) => {
        authorization = request.headers.get("authorization");
        return HttpResponse.json([]);
      }),
    );
    await getVoices();
    expect(authorization).toBe("Bearer test-key");
  });

  it("sends the key entered on the page instead, and the built-in one again once it's forgotten", async () => {
    const seen: Array<string | null> = [];
    server.use(
      http.get(`${API}/voices/`, ({ request }) => {
        seen.push(request.headers.get("authorization"));
        return HttpResponse.json([]);
      }),
    );
    saveApiKey("sk-visitor-1234", false);
    await getVoices();
    forgetApiKey();
    await getVoices();
    expect(seen).toEqual(["Bearer sk-visitor-1234", "Bearer test-key"]);
  });

  it("keys voices by model:id and drops duplicates and bad entries, keeping TTS.ai's order", async () => {
    server.use(
      http.get(`${API}/voices/`, () =>
        HttpResponse.json({
          voices: [
            { id: "FR", model: "openvoice", name: "French", language: "fr" },
            { id: "FR", model: "melotts", name: "French", language: "fr", gender: "female" },
            { voice_id: "siwis", model: "piper", lang: "fr-FR" },
            { id: "FR", model: "melotts", name: "Duplicate" },
            { name: "No ID" },
            "not a voice",
          ],
        }),
      ),
    );
    expect(await getVoices()).toEqual([
      { key: "openvoice:FR", id: "FR", name: "French", language: "fr", model: "openvoice" },
      { key: "melotts:FR", id: "FR", name: "French", language: "fr", model: "melotts", gender: "female" },
      { key: "piper:siwis", id: "siwis", name: "siwis", language: "fr-FR", model: "piper" },
    ]);
  });

  it("explains the missing proxy when an HTML page comes back", async () => {
    server.use(http.get(`${API}/voices/`, () => HttpResponse.html("<!doctype html><html></html>")));
    await expect(getVoices()).rejects.toMatchObject({
      kind: "invalidResponse",
      message: expect.stringContaining("VITE_TTS_API_ORIGIN"),
    });
  });

  it("retries server errors with backoff, then gives up after 3 attempts", async () => {
    const counter = sequence("get", `${API}/voices/`, status(503));
    await expect(getVoices()).rejects.toMatchObject({ kind: "server" });
    expect(counter.calls).toBe(3);
    expect(waitedMs()).toEqual([1000, 2000]);
  });

  it("recovers when a retry succeeds", async () => {
    const counter = sequence("get", `${API}/voices/`, status(500), () => HttpResponse.json([]));
    await expect(getVoices()).resolves.toEqual([]);
    expect(counter.calls).toBe(2);
  });

  it("retries network errors", async () => {
    const counter = sequence("get", `${API}/voices/`, () => HttpResponse.error(), () => HttpResponse.json([]));
    await expect(getVoices()).resolves.toEqual([]);
    expect(counter.calls).toBe(2);
  });

  it("gives up on rate limits after 8 attempts", async () => {
    const counter = sequence("get", `${API}/voices/`, status(429));
    await expect(getVoices()).rejects.toMatchObject({ kind: "rateLimit" });
    expect(counter.calls).toBe(8);
  });

  it.each([
    [{ "Retry-After": "3" }, 3000],
    [{ "X-RateLimit-Reset": "5" }, 5000],
    [{ "Retry-After": "120" }, 60_000],
    [{}, 1000],
  ])("waits as long as rate-limit headers %j say (%d ms, capped at 60 s)", async (headers, expectedMs) => {
    sequence("get", `${API}/voices/`, status(429, {}, headers), () => HttpResponse.json([]));
    await getVoices();
    expect(waitedMs()).toEqual([expectedMs]);
  });

  it.each([
    [401, {}, { kind: "auth", message: expect.stringContaining("rejected your API key") }],
    [402, {}, { kind: "request", message: "Your TTS.ai account is out of credits." }],
    [
      403,
      { error: { message: "Premium voice" } },
      { kind: "request", message: expect.stringContaining("Details: Premium voice") },
    ],
    [
      400,
      { detail: "Text too long" },
      { kind: "request", message: "TTS.ai couldn't process the request (error 400). Details: Text too long" },
    ],
  ])("maps HTTP %d to a readable error without retrying", async (code, body, expected) => {
    const counter = sequence("get", `${API}/voices/`, status(code, body));
    await expect(getVoices()).rejects.toMatchObject(expected);
    expect(counter.calls).toBe(1);
  });

  it("keeps the HTTP status on errors, and none when TTS.ai never answered", async () => {
    sequence("get", `${API}/voices/`, status(404));
    await expect(getVoices()).rejects.toMatchObject({ kind: "request", status: 404 });
    sequence("get", `${API}/voices/`, () => HttpResponse.error());
    await expect(getVoices()).rejects.toMatchObject({ kind: "network", status: undefined });
  });

  it("reports a cancelled request as aborted", async () => {
    server.use(http.get(`${API}/voices/`, () => HttpResponse.json([])));
    const controller = new AbortController();
    controller.abort();
    await expect(getVoices(controller.signal)).rejects.toMatchObject({ kind: "aborted" });
  });
});

describe("submitJob", () => {
  it("sends the voice ID, model, speed and primary language", async () => {
    let body: unknown;
    server.use(
      http.post(`${API}/tts/`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ uuid: "job-1", status: "pending" });
      }),
    );
    await expect(submitJob({ text: "bonjour", voice, speed: 1.2 })).resolves.toEqual({
      jobId: "job-1",
      status: "queued",
    });
    expect(body).toEqual({ text: "bonjour", voice: "FR", model: "melotts", speed: 1.2, format: "mp3", language: "fr" });
  });

  it("reads the credits TTS.ai charged and the balance it reports", async () => {
    server.use(
      http.post(`${API}/tts/`, () =>
        HttpResponse.json({ uuid: "job-1", status: "queued", credits_used: 22, credits_remaining: 14_978 }),
      ),
    );
    await expect(submitJob({ text: "bonjour", voice, speed: 1 })).resolves.toEqual({
      jobId: "job-1",
      status: "queued",
      creditsUsed: 22,
      creditsRemaining: 14_978,
    });
  });

  it("reads a reply for audio TTS.ai already had: done at once, free, and without a balance", async () => {
    server.use(
      http.post(`${API}/tts/`, () =>
        HttpResponse.json({
          uuid: "job-2",
          status: "completed",
          result_url: "https://cdn.tts.ai/job-2/tts_output.mp3",
          credits_used: 0,
          cached: true,
        }),
      ),
    );
    const job = await submitJob({ text: "bonjour", voice, speed: 1 });
    expect(job).toEqual({ jobId: "job-2", status: "completed", creditsUsed: 0 });
    expect(job.creditsRemaining).toBeUndefined();
  });

  it("ignores credit fields that aren't numbers", async () => {
    server.use(
      http.post(`${API}/tts/`, () => HttpResponse.json({ uuid: "job-3", credits_used: "11", credits_remaining: null })),
    );
    const job = await submitJob({ text: "bonjour", voice, speed: 1 });
    expect(job.creditsUsed).toBeUndefined();
    expect(job.creditsRemaining).toBeUndefined();
  });

  it("leaves out the language when the voice has none", async () => {
    let body: unknown;
    server.use(
      http.post(`${API}/tts/`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ uuid: "job-1" });
      }),
    );
    await submitJob({ text: "bonjour", voice: { ...voice, language: "" }, speed: 1 });
    expect(body).not.toHaveProperty("language");
  });

  it("prefers uuid over job_id", async () => {
    server.use(http.post(`${API}/tts/`, () => HttpResponse.json({ job_id: "old", uuid: "new" })));
    await expect(submitJob({ text: "bonjour", voice, speed: 1 })).resolves.toMatchObject({ jobId: "new" });
  });

  it("rejects a reply without a job ID", async () => {
    server.use(http.post(`${API}/tts/`, () => HttpResponse.json({ status: "queued" })));
    await expect(submitJob({ text: "bonjour", voice, speed: 1 })).rejects.toMatchObject({
      kind: "invalidResponse",
    });
  });

  it.each([
    ["a server error", status(500), "server"],
    ["a network error", () => HttpResponse.error(), "network"],
  ])("never resubmits after %s, so a job can't be billed twice", async (_label, respond, kind) => {
    const counter = sequence("post", `${API}/tts/`, respond, () => HttpResponse.json({ uuid: "dup" }));
    await expect(submitJob({ text: "bonjour", voice, speed: 1 })).rejects.toMatchObject({ kind });
    expect(counter.calls).toBe(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("does resubmit after a rate limit, since the job was never created", async () => {
    const counter = sequence("post", `${API}/tts/`, status(429), () => HttpResponse.json({ uuid: "job-1" }));
    await expect(submitJob({ text: "bonjour", voice, speed: 1 })).resolves.toMatchObject({ jobId: "job-1" });
    expect(counter.calls).toBe(2);
  });
});

describe("getJobStatus", () => {
  function replyWith(body: object) {
    server.use(http.get(`${API}/speech/results/`, () => HttpResponse.json(body)));
  }

  it("asks for the job by uuid", async () => {
    let uuid: string | null = null;
    server.use(
      http.get(`${API}/speech/results/`, ({ request }) => {
        uuid = new URL(request.url).searchParams.get("uuid");
        return HttpResponse.json({ status: "queued" });
      }),
    );
    await getJobStatus("job-1");
    expect(uuid).toBe("job-1");
  });

  it.each([
    ["pending", "queued"],
    ["running", "processing"],
    ["STARTED", "processing"],
    ["something new", "processing"],
    ["cancelled", "failed"],
  ])("treats status %j as %j", async (reported, expected) => {
    replyWith({ status: reported });
    await expect(getJobStatus("job-1")).resolves.toMatchObject({ status: expected });
  });

  it("returns the result URL of a completed job", async () => {
    replyWith({ status: "done", audio_url: "https://api.tts.ai/files/a.mp3" });
    await expect(getJobStatus("job-1")).resolves.toEqual({
      status: "completed",
      resultUrl: "https://api.tts.ai/files/a.mp3",
    });
  });

  it("fails a completed job that has no audio URL", async () => {
    replyWith({ status: "completed" });
    await expect(getJobStatus("job-1")).resolves.toEqual({
      status: "failed",
      error: "TTS.ai finished the job but didn't provide an audio file.",
    });
  });

  it("passes on the server's failure message", async () => {
    replyWith({ status: "error", message: "Voice crashed" });
    await expect(getJobStatus("job-1")).resolves.toEqual({ status: "failed", error: "Voice crashed" });
  });
});

describe("downloadAudio", () => {
  const mp3 = () => new HttpResponse(new Uint8Array([0xff, 0xfb, 0x90]), { headers: { "Content-Type": "audio/mpeg" } });

  it("routes TTS.ai file URLs through the API origin, without the API key", async () => {
    let authorization: string | null = "unset";
    server.use(
      http.get(`${ORIGIN}/files/a.mp3`, ({ request }) => {
        authorization = request.headers.get("authorization");
        return mp3();
      }),
    );
    const blob = await downloadAudio("https://api.tts.ai/files/a.mp3");
    expect(blob.size).toBe(3);
    expect(authorization).toBeNull();
  });

  it("routes relative URLs through the API origin", async () => {
    server.use(http.get(`${ORIGIN}/files/b.mp3`, mp3));
    await expect(downloadAudio("/files/b.mp3")).resolves.toHaveProperty("size", 3);
  });

  it("rejects an empty file", async () => {
    server.use(http.get(`${ORIGIN}/files/empty.mp3`, () => new HttpResponse(null, { status: 200 })));
    await expect(downloadAudio("/files/empty.mp3")).rejects.toMatchObject({ kind: "invalidResponse" });
  });

  it("explains the missing proxy when an HTML page comes back", async () => {
    server.use(http.get(`${ORIGIN}/files/c.mp3`, () => HttpResponse.html("<!doctype html><html></html>")));
    await expect(downloadAudio("/files/c.mp3")).rejects.toMatchObject({
      kind: "invalidResponse",
      message: expect.stringContaining("VITE_TTS_API_ORIGIN"),
    });
  });
});
