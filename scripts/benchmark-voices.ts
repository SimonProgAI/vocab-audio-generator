/**
 * Times how long each TTS.ai voice takes to generate the same text, then ranks them from
 * fastest to slowest. This spends real credits, so it prints an estimate and asks first.
 * It is deliberately not part of `npm test`.
 *
 *   npm run benchmark:voices -- --dry-run
 *   npm run benchmark:voices -- --text "une rivière" --runs 3 --language fr --model piper,melotts
 *
 * Jobs run one at a time, in a new random order each round, so no voice waits behind another
 * or always lands on a busy moment. Each run is appended to benchmark-results/*.jsonl as soon
 * as it finishes; the ranked summary is written to a .csv next to it.
 *
 * Needs Node 23.6+ (it runs TypeScript directly) and VITE_TTS_API_KEY in .env.
 * Standalone on purpose: src/services/ttsApi.ts depends on Vite, and its retries would skew timings.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

const API_ORIGIN = "https://api.tts.ai";
const RESULTS_DIR = "benchmark-results";
/** Premium models use 4 characters of credit per character of text (https://tts.ai/api). */
const MAX_CREDIT_MULTIPLIER = 4;
const MAX_ATTEMPTS = 5;

export interface ClientOptions {
  origin: string;
  apiKey: string;
  pollMs: number;
  timeoutMs: number;
}

export interface BenchVoice {
  /** "model:id", like the app's Voice.key. */
  key: string;
  id: string;
  name: string;
  language: string;
  model: string;
}

export type Outcome = "completed" | "failed" | "timeout" | "error";

export interface RunResult {
  key: string;
  name: string;
  model: string;
  round: number;
  outcome: Outcome;
  /** Submit → the first poll that saw the finished job. */
  elapsedMs?: number;
  /** The job finished at most this long before elapsedMs (the gap since the previous poll). */
  precisionMs?: number;
  /** Submit → the first poll that saw the job processing: roughly its time in TTS.ai's queue. */
  queuedMs?: number;
  creditsUsed?: number;
  creditsRemaining?: number;
  /** 429 replies; their waits make elapsedMs less precise. */
  rateLimited: number;
  error?: string;
  /** Last raw status reply, kept so any server-side timing fields can be inspected. */
  lastStatus?: unknown;
}

export interface VoiceSummary {
  key: string;
  name: string;
  model: string;
  runs: number;
  completed: number;
  medianMs?: number;
  minMs?: number;
  maxMs?: number;
  medianQueuedMs?: number;
  /** credits_used ÷ text length: 1 = free tier, 2 = standard, 4 = premium. */
  creditsPerChar?: number;
  problems: string[];
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

class HttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | undefined;

  constructor(status: number, body: unknown, retryAfterMs: number | undefined) {
    const detail = serverMessage(body);
    super(detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function retryAfterMs(headers: Headers): number | undefined {
  const retryAfter = Number(headers.get("retry-after") ?? Number.NaN);
  if (Number.isFinite(retryAfter)) return retryAfter * 1000;
  const reset = Number(headers.get("x-ratelimit-reset") ?? Number.NaN);
  if (!Number.isFinite(reset)) return undefined;
  // X-RateLimit-Reset may be a Unix timestamp or a number of seconds.
  return reset > 1e9 ? Math.max(reset * 1000 - Date.now(), 0) : reset * 1000;
}

async function call(options: ClientOptions, path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${options.origin}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: keep the text for the error message.
  }
  if (!response.ok) throw new HttpError(response.status, body, retryAfterMs(response.headers));
  return body;
}

/**
 * Retries 429s after Retry-After. Reads (`repeatable`) also retry network and server errors.
 * Submits never do: resending could create, and bill, a duplicate job.
 */
async function send(
  options: ClientOptions,
  path: string,
  init: RequestInit,
  run: Pick<RunResult, "rateLimited">,
  repeatable: boolean,
): Promise<unknown> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call(options, path, init);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : undefined;
      const rateLimited = status === 429;
      const transient = status === undefined || status >= 500;
      if (rateLimited) run.rateLimited += 1;
      if (attempt >= MAX_ATTEMPTS || !(rateLimited || (repeatable && transient))) throw error;
      const waitMs = error instanceof HttpError && error.retryAfterMs !== undefined ? error.retryAfterMs : 1000 * attempt;
      await sleep(Math.min(waitMs, 60_000));
    }
  }
}

// ---------------------------------------------------------------------------
// Parsing (TTS.ai replies are untrusted, so every field is checked)
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function readString(record: JsonRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function readNumber(record: JsonRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function serverMessage(body: unknown): string | undefined {
  if (typeof body === "string") return body.trim().startsWith("<") ? undefined : body.trim().slice(0, 200) || undefined;
  const record = asRecord(body);
  const nested = asRecord(record.error);
  return (readString(nested, "message") ?? readString(record, "error", "message", "detail"))?.slice(0, 200);
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "A request took longer than 30 s.";
  return error instanceof Error ? error.message : String(error);
}

/** "fr-FR" → "fr" */
export function primaryLanguage(code: string): string {
  return (code.split(/[-_]/)[0] ?? "").toLowerCase();
}

export function parseVoices(data: unknown): BenchVoice[] {
  const list = Array.isArray(data) ? data : asRecord(data).voices;
  if (!Array.isArray(list)) throw new Error("TTS.ai sent the voice list in an unexpected format.");
  const voices = new Map<string, BenchVoice>();
  for (const entry of list) {
    const record = asRecord(entry);
    const id = readString(record, "id", "voice_id");
    const model = readString(record, "model");
    if (!id || !model) continue;
    const key = `${model}:${id}`;
    if (voices.has(key)) continue;
    voices.set(key, {
      key,
      id,
      name: readString(record, "name") ?? id,
      language: readString(record, "language", "lang") ?? "",
      model,
    });
  }
  return [...voices.values()];
}

/** `language` is a primary code like "fr", or "all". `models` empty means every model. */
export function selectVoices(voices: readonly BenchVoice[], language: string, models: readonly string[]): BenchVoice[] {
  const wanted = language.toLowerCase();
  return voices
    .filter((voice) => wanted === "all" || primaryLanguage(voice.language) === wanted)
    .filter((voice) => models.length === 0 || models.includes(voice.model))
    .sort((a, b) => a.model.localeCompare(b.model) || a.name.localeCompare(b.name));
}

const PROCESSING = new Set(["processing", "running", "started"]);
const DONE = new Set(["completed", "complete", "done", "success", "succeeded"]);
const FAILED = new Set(["failed", "error", "cancelled", "canceled"]);

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------

export async function fetchVoices(options: ClientOptions): Promise<BenchVoice[]> {
  return parseVoices(await send(options, "/v1/voices/", {}, { rateLimited: 0 }, true));
}

/** Submits one job and polls it until it finishes, fails or times out. Never throws. */
export async function runJob(
  voice: BenchVoice,
  text: string,
  round: number,
  options: ClientOptions,
): Promise<RunResult> {
  const result: RunResult = { key: voice.key, name: voice.name, model: voice.model, round, outcome: "error", rateLimited: 0 };
  const start = performance.now();
  const since = () => Math.round(performance.now() - start);

  try {
    const body = {
      text,
      voice: voice.id,
      model: voice.model,
      speed: 1,
      format: "mp3",
      language: primaryLanguage(voice.language) || undefined,
    };
    const submitted = asRecord(await send(options, "/v1/tts/", { method: "POST", body: JSON.stringify(body) }, result, false));
    result.creditsUsed = readNumber(submitted, "credits_used");
    result.creditsRemaining = readNumber(submitted, "credits_remaining");
    const uuid = readString(submitted, "uuid", "job_id");
    if (!uuid) throw new Error("TTS.ai accepted the job but didn't return a job ID.");

    let previousPoll = since();
    while (since() < options.timeoutMs) {
      await sleep(options.pollMs);
      const reply = await send(options, `/v1/speech/results/?uuid=${encodeURIComponent(uuid)}`, {}, result, true);
      const now = since();
      const record = asRecord(reply);
      const status = (readString(record, "status") ?? "").toLowerCase();
      result.lastStatus = reply;
      if (PROCESSING.has(status)) result.queuedMs ??= now;

      if (DONE.has(status) && readString(record, "result_url", "url", "audio_url")) {
        result.outcome = "completed";
        result.elapsedMs = now;
        result.precisionMs = now - previousPoll;
        return result;
      }
      if (DONE.has(status) || FAILED.has(status)) {
        result.outcome = "failed";
        result.error = DONE.has(status)
          ? "Finished without an audio URL."
          : (readString(record, "error", "message") ?? `Status "${status}".`);
        return result;
      }
      previousPoll = now;
    }
    result.outcome = "timeout";
    result.error = `Not finished after ${options.timeoutMs / 1000} s.`;
  } catch (error) {
    result.outcome = "error";
    result.error = describeError(error);
  }
  return result;
}

/** Fisher–Yates: every order is equally likely. */
function shuffled<T>(values: readonly T[]): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other] as T, copy[index] as T];
  }
  return copy;
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? upper) + upper) / 2;
}

/** One row per voice: voices with finished runs first, fastest median first; the rest after. */
export function summarize(results: readonly RunResult[], textLength: number): VoiceSummary[] {
  const byVoice = new Map<string, RunResult[]>();
  for (const result of results) byVoice.set(result.key, [...(byVoice.get(result.key) ?? []), result]);

  const summaries = [...byVoice.values()].map((runs): VoiceSummary => {
    const [first] = runs;
    const times = runs.flatMap((run) => (run.elapsedMs === undefined ? [] : [run.elapsedMs]));
    const queued = runs.flatMap((run) => (run.queuedMs === undefined ? [] : [run.queuedMs]));
    const credits = runs.flatMap((run) => (run.creditsUsed === undefined ? [] : [run.creditsUsed / textLength]));
    const perChar = median(credits);
    const problems = new Map<string, number>();
    for (const run of runs) {
      if (run.outcome !== "completed") {
        const label = `${run.outcome}: ${run.error ?? "unknown"}`;
        problems.set(label, (problems.get(label) ?? 0) + 1);
      }
    }
    return {
      key: first?.key ?? "",
      name: first?.name ?? "",
      model: first?.model ?? "",
      runs: runs.length,
      completed: times.length,
      medianMs: median(times),
      minMs: times.length > 0 ? Math.min(...times) : undefined,
      maxMs: times.length > 0 ? Math.max(...times) : undefined,
      medianQueuedMs: median(queued),
      creditsPerChar: perChar === undefined ? undefined : Math.round(perChar * 100) / 100,
      problems: [...problems].map(([label, count]) => (count > 1 ? `${label} (×${count})` : label)),
    };
  });

  return summaries.sort(
    (a, b) =>
      (a.medianMs ?? Number.POSITIVE_INFINITY) - (b.medianMs ?? Number.POSITIVE_INFINITY) ||
      b.completed - a.completed ||
      a.name.localeCompare(b.name),
  );
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const seconds = (ms: number | undefined) => (ms === undefined ? "" : (ms / 1000).toFixed(1));

function formatTable(rows: string[][]): string {
  const widths = rows[0]?.map((_, column) => Math.max(...rows.map((row) => (row[column] ?? "").length))) ?? [];
  return rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ").trimEnd()).join("\n");
}

function summaryRows(summaries: readonly VoiceSummary[]): string[][] {
  return [
    ["#", "Voice", "Model", "Median s", "Min–max s", "OK", "Credits/char", "Problems"],
    ...summaries.map((summary, index) => [
      String(index + 1),
      summary.name,
      summary.model,
      seconds(summary.medianMs),
      summary.minMs === undefined ? "" : `${seconds(summary.minMs)}–${seconds(summary.maxMs)}`,
      `${summary.completed}/${summary.runs}`,
      summary.creditsPerChar === undefined ? "" : String(summary.creditsPerChar),
      summary.problems.join("; "),
    ]),
  ];
}

export function toCsv(summaries: readonly VoiceSummary[]): string {
  const header = ["rank", "name", "voice", "model", "median_s", "min_s", "max_s", "completed", "runs", "queued_median_s", "credits_per_char", "problems"];
  const rows = summaries.map((summary, index) => [
    String(index + 1),
    summary.name,
    summary.key,
    summary.model,
    seconds(summary.medianMs),
    seconds(summary.minMs),
    seconds(summary.maxMs),
    String(summary.completed),
    String(summary.runs),
    seconds(summary.medianQueuedMs),
    summary.creditsPerChar === undefined ? "" : String(summary.creditsPerChar),
    summary.problems.join("; "),
  ]);
  const escape = (cell: string) => (/[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell);
  return [header, ...rows].map((row) => row.map(escape).join(",")).join("\n") + "\n";
}

function describeRun(result: RunResult): string {
  const rateLimited = result.rateLimited > 0 ? ` (rate-limited ×${result.rateLimited})` : "";
  if (result.outcome === "completed") return `${seconds(result.elapsedMs)} s${rateLimited}`;
  return `${result.outcome.toUpperCase()}: ${result.error ?? "unknown"}${rateLimited}`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function positiveNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${flag} must be a positive number.`);
  return parsed;
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) throw new Error("No terminal to ask for confirmation. Pass --yes to run anyway.");
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await prompt.question(question)).trim());
  } finally {
    prompt.close();
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      text: { type: "string", default: "une rivière" },
      runs: { type: "string", default: "3" },
      language: { type: "string", default: "fr" },
      model: { type: "string", default: "" },
      poll: { type: "string", default: "1" },
      timeout: { type: "string", default: "120" },
      yes: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });

  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env: fall back to the shell environment.
  }
  const apiKey = process.env.VITE_TTS_API_KEY?.trim();
  if (!apiKey) throw new Error("Set VITE_TTS_API_KEY in .env first.");

  const text = values.text.trim();
  const textLength = [...text].length;
  if (textLength === 0) throw new Error("--text can't be empty.");
  const runs = Math.round(positiveNumber(values.runs, "runs"));
  const options: ClientOptions = {
    origin: API_ORIGIN,
    apiKey,
    pollMs: positiveNumber(values.poll, "poll") * 1000,
    timeoutMs: positiveNumber(values.timeout, "timeout") * 1000,
  };
  const models = values.model.split(",").map((model) => model.trim()).filter(Boolean);

  const voices = selectVoices(await fetchVoices(options), values.language, models);
  if (voices.length === 0) throw new Error("No voices match --language and --model.");

  const modelCount = new Set(voices.map((voice) => voice.model)).size;
  const jobs = voices.length * runs;
  const cheapest = textLength * jobs;
  console.log(formatTable([["Model", "Voice", "ID"], ...voices.map((voice) => [voice.model, voice.name, voice.id])]));
  console.log(
    [
      "",
      `${voices.length} voices across ${modelCount} models × ${runs} runs = ${jobs} jobs, one at a time.`,
      `Text: "${text}" (${textLength} characters).`,
      `Estimated cost: ${cheapest.toLocaleString("en")} characters if every model is free tier,` +
        ` up to ${(cheapest * MAX_CREDIT_MULTIPLIER).toLocaleString("en")} if they're all premium.`,
      `Polling every ${options.pollMs / 1000} s; a job not done after ${options.timeoutMs / 1000} s counts as timed out.`,
      "",
    ].join("\n"),
  );
  if (values["dry-run"]) return;
  if (!values.yes && !(await confirm("Spend these credits and start? [y/N] "))) {
    console.log("Cancelled. Nothing was spent.");
    return;
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const base = `${RESULTS_DIR}/voices-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  const results: RunResult[] = [];
  for (let round = 1; round <= runs; round += 1) {
    for (const voice of shuffled(voices)) {
      process.stdout.write(`[${results.length + 1}/${jobs}] round ${round}: ${voice.name} (${voice.model})… `);
      const result = await runJob(voice, text, round, options);
      results.push(result);
      appendFileSync(`${base}.jsonl`, `${JSON.stringify(result)}\n`);
      console.log(describeRun(result));
    }
  }

  const summaries = summarize(results, textLength);
  writeFileSync(`${base}.csv`, toCsv(summaries));
  const spent = results.reduce((total, result) => total + (result.creditsUsed ?? 0), 0);
  const remaining = results.findLast((result) => result.creditsRemaining !== undefined)?.creditsRemaining;
  console.log(`\n${formatTable(summaryRows(summaries))}\n`);
  console.log(`Credits used: ${spent.toLocaleString("en")}${remaining === undefined ? "" : `, ${remaining.toLocaleString("en")} left`}.`);
  console.log(`Saved ${base}.csv (summary) and ${base}.jsonl (every run, with TTS.ai's last reply).`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(describeError(error));
    process.exitCode = 1;
  });
}
