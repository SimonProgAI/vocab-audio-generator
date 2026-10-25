import { http, HttpResponse } from "msw/http";
import { describe, expect, it } from "vitest";
import { server } from "../src/test/server";
import {
  DEFAULT_TEXTS,
  measureVoice,
  median,
  parseVoices,
  runJob,
  selectVoices,
  summarize,
  toCsv,
  type BenchVoice,
  type ClientOptions,
  type RunResult,
} from "./benchmark-voices";

const ORIGIN = "https://tts.test";
const options: ClientOptions = { origin: ORIGIN, apiKey: "test-key", pollMs: 5, timeoutMs: 1000 };
const voice: BenchVoice = {
  key: "piper:fr_FR-siwis-medium",
  id: "fr_FR-siwis-medium",
  name: "Siwis (French)",
  language: "fr-FR",
  model: "piper",
};
const DONE = { status: "completed", result_url: "https://api.tts.ai/files/a.mp3" };

/** Accepts submits with `replies` in turn (repeating the last), recording each request. */
function acceptSubmits(...replies: Array<() => Response>) {
  const requests: Array<{ authorization: string | null; body: unknown }> = [];
  const respond = replies.length > 0 ? replies : [() => HttpResponse.json({ uuid: "job-1", credits_used: 11, credits_remaining: 14_989 })];
  server.use(
    http.post(`${ORIGIN}/v1/tts/`, async ({ request }) => {
      requests.push({ authorization: request.headers.get("authorization"), body: await request.json() });
      return (respond[Math.min(requests.length - 1, respond.length - 1)] as () => Response)();
    }),
  );
  return requests;
}

/** Answers status polls with each reply in turn, repeating the last one. */
function statuses(...replies: Array<object | (() => Response)>) {
  let calls = 0;
  server.use(
    http.get(`${ORIGIN}/v1/speech/results/`, () => {
      const reply = replies[Math.min(calls, replies.length - 1)];
      calls += 1;
      return typeof reply === "function" ? reply() : HttpResponse.json(reply ?? {});
    }),
  );
}

describe("runJob", () => {
  it("times a job from submit until a poll sees it completed", async () => {
    const submits = acceptSubmits();
    statuses({ status: "queued" }, { status: "processing" }, DONE);

    const result = await runJob(voice, "une rivière", 2, options);

    expect(result).toMatchObject({
      key: voice.key,
      round: 2,
      outcome: "completed",
      creditsUsed: 11,
      creditsRemaining: 14_989,
      rateLimited: 0,
      lastStatus: DONE,
    });
    expect(result.queuedMs).toBeGreaterThan(0);
    expect(result.elapsedMs).toBeGreaterThan(result.queuedMs ?? Number.POSITIVE_INFINITY);
    expect(result.precisionMs).toBeGreaterThan(0);
    expect(submits).toEqual([
      {
        authorization: "Bearer test-key",
        body: { text: "une rivière", voice: "fr_FR-siwis-medium", model: "piper", speed: 1, format: "mp3", language: "fr" },
      },
    ]);
  });

  it("reports a failed job with TTS.ai's message", async () => {
    acceptSubmits();
    statuses({ status: "error", message: "Voice crashed" });
    const result = await runJob(voice, "une rivière", 1, options);
    expect(result).toMatchObject({ outcome: "failed", error: "Voice crashed" });
    expect(result.elapsedMs).toBeUndefined();
  });

  it("counts a completed job without audio as failed", async () => {
    acceptSubmits();
    statuses({ status: "done" });
    await expect(runJob(voice, "une rivière", 1, options)).resolves.toMatchObject({
      outcome: "failed",
      error: "Finished without an audio URL.",
    });
  });

  it("gives up on a job that runs past the timeout", async () => {
    acceptSubmits();
    statuses({ status: "processing" });
    await expect(runJob(voice, "une rivière", 1, { ...options, timeoutMs: 40 })).resolves.toMatchObject({
      outcome: "timeout",
      error: "Not finished after 0.04 s.",
    });
  });

  it("never resubmits after a server error, so a job can't be billed twice", async () => {
    const submits = acceptSubmits(() => HttpResponse.json({ error: "Overloaded" }, { status: 500 }));
    await expect(runJob(voice, "une rivière", 1, options)).resolves.toMatchObject({
      outcome: "error",
      error: "HTTP 500: Overloaded",
    });
    expect(submits).toHaveLength(1);
  });

  it("resubmits after a rate limit, and counts it", async () => {
    const submits = acceptSubmits(
      () => HttpResponse.json({}, { status: 429, headers: { "Retry-After": "0" } }),
      () => HttpResponse.json({ uuid: "job-1" }),
    );
    statuses(DONE);
    await expect(runJob(voice, "une rivière", 1, options)).resolves.toMatchObject({
      outcome: "completed",
      rateLimited: 1,
    });
    expect(submits).toHaveLength(2);
  });

  it("retries a status poll that hits a server error", async () => {
    acceptSubmits();
    statuses(() => HttpResponse.json({}, { status: 503, headers: { "Retry-After": "0" } }), DONE);
    await expect(runJob(voice, "une rivière", 1, options)).resolves.toMatchObject({ outcome: "completed" });
  });

  it("fails when the submit reply has no job ID", async () => {
    acceptSubmits(() => HttpResponse.json({ status: "queued" }));
    await expect(runJob(voice, "une rivière", 1, options)).resolves.toMatchObject({
      outcome: "error",
      error: "TTS.ai accepted the job but didn't return a job ID.",
    });
  });
});

describe("parseVoices and selectVoices", () => {
  const voices = parseVoices({
    voices: [
      { id: "FR", model: "openvoice", name: "French", language: "fr" },
      { id: "fr_FR-siwis-medium", model: "piper", name: "Siwis (French)", language: "fr-FR" },
      { id: "FR", model: "melotts", name: "French", language: "fr" },
      { id: "FR", model: "melotts", name: "Duplicate", language: "fr" },
      { id: "en_1", model: "bark", name: "English Male 1", language: "en" },
      { id: "no-model", name: "No model", language: "fr" },
      "not a voice",
    ],
  });

  it("keys voices by model:id and drops duplicates and entries without an id or model", () => {
    expect(voices.map((v) => v.key)).toEqual(["openvoice:FR", "piper:fr_FR-siwis-medium", "melotts:FR", "bark:en_1"]);
  });

  it("filters by primary language and model, sorted by model", () => {
    expect(selectVoices(voices, "fr", []).map((v) => v.key)).toEqual([
      "melotts:FR",
      "openvoice:FR",
      "piper:fr_FR-siwis-medium",
    ]);
    expect(selectVoices(voices, "FR", ["piper", "bark"]).map((v) => v.key)).toEqual(["piper:fr_FR-siwis-medium"]);
    expect(selectVoices(voices, "all", [])).toHaveLength(4);
  });

  it("accepts a bare array too", () => {
    expect(parseVoices([{ id: "FR", model: "melotts" }])).toEqual([
      { key: "melotts:FR", id: "FR", name: "FR", language: "", model: "melotts" },
    ]);
  });
});

describe("median", () => {
  it.each([
    [[], undefined],
    [[3, 1, 2], 2],
    [[4, 1, 3, 2], 2.5],
  ])("%j → %j", (values, expected) => {
    expect(median(values)).toBe(expected);
  });
});


describe("reused audio", () => {
  const reused = () =>
    HttpResponse.json({
      uuid: "old",
      status: "completed",
      result_url: "https://cdn.tts.ai/old/tts_output.mp3",
      credits_used: 0,
      cached: true,
    });

  it("doesn't time a reply with audio TTS.ai already had", async () => {
    acceptSubmits(reused);
    // No status handler: polling would fail the test.
    const run = await runJob(voice, "une rivière", 1, options);
    expect(run).toMatchObject({ outcome: "reused", text: "une rivière", creditsUsed: 0 });
    expect(run.elapsedMs).toBeUndefined();
  });

  it("treats a free reply as reused even without the cached flag", async () => {
    acceptSubmits(() => HttpResponse.json({ uuid: "old", status: "completed", credits_used: 0 }));
    await expect(runJob(voice, "une rivière", 1, options)).resolves.toMatchObject({ outcome: "reused" });
  });

  it("moves on to the voice's next phrase until one is really generated", async () => {
    const submits = acceptSubmits(reused, () => HttpResponse.json({ uuid: "new", credits_used: 11 }));
    statuses(DONE);
    const used = new Map<string, number>();
    const seen: RunResult[] = [];

    const run = await measureVoice(voice, 1, ["une rivière", "la montagne", "un escalier"], used, options, (attempt) =>
      seen.push(attempt),
    );

    expect(run).toMatchObject({ outcome: "completed", text: "la montagne", creditsUsed: 11 });
    expect(seen.map((attempt) => [attempt.text, attempt.outcome])).toEqual([
      ["une rivière", "reused"],
      ["la montagne", "completed"],
    ]);
    expect(submits.map((request) => (request.body as { text: string }).text)).toEqual(["une rivière", "la montagne"]);
    expect(used.get(voice.key)).toBe(2);
  });

  it("starts each round where the voice's last one stopped", async () => {
    const submits = acceptSubmits();
    statuses(DONE);
    const used = new Map([[voice.key, 2]]);
    await measureVoice(voice, 2, ["une rivière", "la montagne", "un escalier"], used, options);
    expect(submits.map((request) => (request.body as { text: string }).text)).toEqual(["un escalier"]);
  });

  it("says so when every phrase was already generated, without sending anything", async () => {
    const used = new Map([[voice.key, 1]]);
    await expect(measureVoice(voice, 2, ["une rivière"], used, options)).resolves.toMatchObject({
      outcome: "reused",
      text: "",
      error: expect.stringContaining("Pass new ones with --text"),
    });
  });

  it("ships phrases that are all different and all 11 characters long", () => {
    expect(new Set(DEFAULT_TEXTS).size).toBe(DEFAULT_TEXTS.length);
    expect(DEFAULT_TEXTS.map((text) => [...text].length)).toEqual(DEFAULT_TEXTS.map(() => 11));
  });
});

describe("summarize", () => {
  const TIMEOUT = 120_000;
  const run = (key: string, outcome: RunResult["outcome"], extra: Partial<RunResult> = {}): RunResult => ({
    key,
    name: key,
    model: key.split(":")[0] ?? "",
    round: 1,
    text: "une rivière",
    outcome,
    rateLimited: 0,
    ...extra,
  });

  const summaries = summarize(
    [
      run("slow:a", "completed", { elapsedMs: 1000, creditsUsed: 22, queuedMs: 100 }),
      run("slow:a", "completed", { elapsedMs: 3000, creditsUsed: 22, queuedMs: 300 }),
      run("slow:a", "completed", { elapsedMs: 2000, creditsUsed: 22, queuedMs: 200 }),
      run("broken:c", "failed", { error: "Voice crashed" }),
      run("fast:b", "reused", { creditsUsed: 0 }),
      run("fast:b", "completed", { elapsedMs: 500, creditsUsed: 11, text: "la montagne" }),
      run("broken:c", "failed", { error: "Voice crashed" }),
      run("fast:b", "reused", { creditsUsed: 0, elapsedMs: undefined }),
      run("flaky:d", "completed", { elapsedMs: 800, creditsUsed: 22 }),
      run("flaky:d", "timeout", { error: "Not finished after 120 s.", creditsUsed: 22 }),
      run("flaky:d", "timeout", { error: "Not finished after 120 s.", creditsUsed: 22 }),
      run("spent:e", "reused", { text: "", error: "TTS.ai already had audio for every test phrase with this voice." }),
    ],
    TIMEOUT,
  );

  it("ranks by median time, with timeouts counted as the timeout, and puts unmeasured voices last", () => {
    expect(summaries.map((summary) => summary.key)).toEqual(["fast:b", "slow:a", "flaky:d", "broken:c", "spent:e"]);
  });

  it("leaves reused runs out of the timing and the credits per character", () => {
    expect(summaries[0]).toMatchObject({
      key: "fast:b",
      runs: 1,
      completed: 1,
      reused: 2,
      medianMs: 500,
      medianIsLowerBound: false,
      creditsPerChar: 1,
      problems: [],
    });
  });

  it("summarizes finished runs", () => {
    expect(summaries[1]).toMatchObject({
      key: "slow:a",
      runs: 3,
      completed: 3,
      timeouts: 0,
      medianMs: 2000,
      minMs: 1000,
      maxMs: 3000,
      medianQueuedMs: 200,
      creditsPerChar: 2,
      problems: [],
    });
  });

  it("marks a median that includes timeouts as a lower bound", () => {
    expect(summaries[2]).toMatchObject({
      key: "flaky:d",
      runs: 3,
      completed: 1,
      timeouts: 2,
      medianMs: TIMEOUT,
      medianIsLowerBound: true,
      minMs: 800,
      maxMs: 800,
      creditsPerChar: 2,
      problems: ["timeout: Not finished after 120 s. (×2)"],
    });
  });

  it("lists failures, and voices with no phrases left", () => {
    expect(summaries[3]).toMatchObject({ key: "broken:c", completed: 0, medianMs: undefined, problems: ["failed: Voice crashed (×2)"] });
    expect(summaries[4]).toMatchObject({
      key: "spent:e",
      runs: 0,
      reused: 0,
      problems: ["TTS.ai already had audio for every test phrase with this voice."],
    });
  });

  it("writes a CSV with quoted cells where needed", () => {
    const broken = summaries[3];
    if (!broken) throw new Error("Expected a summary for broken:c.");
    const csv = toCsv([{ ...broken, name: 'Le "grand", lui' }]);
    expect(csv).toBe(
      "rank,name,voice,model,median_s,median_is_lower_bound,min_s,max_s,completed,timeouts,runs,reused,queued_median_s,credits_per_char,problems\n" +
        '1,"Le ""grand"", lui",broken:c,broken,,false,,,0,0,2,0,,,failed: Voice crashed (×2)\n',
    );
  });
});
