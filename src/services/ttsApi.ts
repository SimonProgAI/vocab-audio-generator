import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponseHeaders,
  type RawAxiosResponseHeaders,
} from "axios";
import type { JobStatus, Voice } from "../types/queue";
import { primaryLanguage } from "../utils/voices";
import { wait } from "../utils/wait";
import { currentApiKey } from "./apiKey";

/** Public TTS.ai host. Result URLs that point here are rerouted through API_ORIGIN. */
const TTS_UPSTREAM_ORIGIN = "https://api.tts.ai";
const API_ORIGIN = (import.meta.env.VITE_TTS_API_ORIGIN || "/tts-api").replace(/\/+$/, "");

export function hasApiKey(): boolean {
  return currentApiKey() !== "";
}

const apiClient = axios.create({ baseURL: `${API_ORIGIN}/v1`, timeout: 30_000 });

// Read on every request, so a key entered (or forgotten) on the page applies right away.
apiClient.interceptors.request.use((config) => {
  const key = currentApiKey();
  if (key) config.headers.set("Authorization", `Bearer ${key}`);
  return config;
});

// Result files are plain downloads: no auth header, longer timeout.
const downloadClient = axios.create({ timeout: 60_000 });

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type TtsErrorKind =
  | "auth"
  | "rateLimit"
  | "network"
  | "server"
  | "request"
  | "invalidResponse"
  | "aborted"
  | "unknown";

export class TtsApiError extends Error {
  readonly kind: TtsErrorKind;
  readonly retryAfterMs: number | undefined;
  /** HTTP status, when the server answered. */
  readonly status: number | undefined;

  constructor(kind: TtsErrorKind, message: string, retryAfterMs?: number, status?: number) {
    super(message);
    this.name = "TtsApiError";
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
    this.status = status;
  }
}

const PROXY_HINT =
  "TTS.ai sent back a web page instead of data. If you are running a production build, set VITE_TTS_API_ORIGIN — the /tts-api proxy only exists under `npm run dev` and `npm run preview`.";

export function toTtsApiError(error: unknown): TtsApiError {
  if (error instanceof TtsApiError) return error;
  if (axios.isCancel(error)) return new TtsApiError("aborted", "The request was cancelled.");
  if (axios.isAxiosError(error)) return fromAxiosError(error);
  if (error instanceof Error) return new TtsApiError("unknown", error.message);
  return new TtsApiError("unknown", "Something unexpected went wrong. Please try again.");
}

/** User-facing message for any error thrown by the services layer. */
export function getErrorMessage(error: unknown): string {
  return toTtsApiError(error).message;
}

function fromAxiosError(error: AxiosError): TtsApiError {
  const { response } = error;
  if (!response) {
    return error.code === "ECONNABORTED" || error.code === "ETIMEDOUT"
      ? new TtsApiError("network", "TTS.ai took too long to respond. Check your connection and try again.")
      : new TtsApiError("network", "Couldn't reach TTS.ai. Check your internet connection and try again.");
  }

  const { status } = response;
  const detail = extractServerMessage(response.data);
  const answered = (kind: TtsErrorKind, message: string, retryAfter?: number) =>
    new TtsApiError(kind, message, retryAfter, status);

  if (status === 401) {
    return answered(
      "auth",
      hasApiKey()
        ? "TTS.ai rejected your API key. Check the key in the TTS.ai API key box at the top of the page."
        : "TTS.ai needs an API key for this. Enter yours in the TTS.ai API key box at the top of the page.",
    );
  }
  if (status === 429) {
    return answered(
      "rateLimit",
      "TTS.ai's rate limit was reached. Wait a minute and try again, or upgrade your TTS.ai plan for higher limits.",
      retryAfterMs(response.headers),
    );
  }
  if (status === 402) {
    return answered("request", "Your TTS.ai account is out of credits.");
  }
  if (status === 403) {
    return answered(
      "request",
      withDetail("TTS.ai refused this request. Your plan may not include this voice.", detail),
    );
  }
  if (status >= 500) {
    return answered(
      "server",
      `TTS.ai is having trouble right now (error ${status}). Please try again shortly.`,
    );
  }
  return answered("request", withDetail(`TTS.ai couldn't process the request (error ${status}).`, detail));
}

function withDetail(message: string, detail: string | undefined): string {
  return detail ? `${message} Details: ${detail}` : message;
}

function extractServerMessage(data: unknown): string | undefined {
  if (typeof data === "string") {
    const text = data.trim();
    return text && !text.startsWith("<") ? text.slice(0, 200) : undefined;
  }
  if (!isRecord(data)) return undefined;
  for (const key of ["error", "message", "detail"]) {
    const value = data[key];
    const message = isRecord(value) ? readString(value, "message") : readString(data, key);
    if (message) return message.slice(0, 200);
  }
  return undefined;
}

type ResponseHeaders = RawAxiosResponseHeaders | AxiosResponseHeaders;

function readNumberHeader(headers: ResponseHeaders, name: string): number | undefined {
  const value: unknown = headers[name];
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function retryAfterMs(headers: ResponseHeaders): number | undefined {
  const retryAfter = readNumberHeader(headers, "retry-after");
  if (retryAfter !== undefined) return retryAfter * 1000;
  const reset = readNumberHeader(headers, "x-ratelimit-reset");
  if (reset === undefined) return undefined;
  // X-RateLimit-Reset may be a Unix timestamp or a number of seconds.
  return reset > 1e9 ? reset * 1000 - Date.now() : reset * 1000;
}

// ---------------------------------------------------------------------------
// Transport with retries
// ---------------------------------------------------------------------------

const READ_RETRY: readonly TtsErrorKind[] = ["rateLimit", "network", "server"];
// Resubmitting after a network or server error could create (and bill) a duplicate job.
const SUBMIT_RETRY: readonly TtsErrorKind[] = ["rateLimit"];

const MAX_RATE_LIMIT_ATTEMPTS = 8;
const MAX_ATTEMPTS = 3;

function retryDelayMs(error: TtsApiError, attempt: number): number {
  const backoff = 1000 * 2 ** (attempt - 1);
  return Math.min(Math.max(error.retryAfterMs ?? backoff, 1000), 60_000);
}

interface SendOptions {
  signal: AbortSignal | undefined;
  retryOn: readonly TtsErrorKind[];
}

async function send<T>(
  client: AxiosInstance,
  config: AxiosRequestConfig,
  parse: (data: unknown) => T,
  { signal, retryOn }: SendOptions,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await client.request<unknown>({ ...config, signal });
      return parse(response.data);
    } catch (error) {
      const apiError = toTtsApiError(error);
      const maxAttempts = apiError.kind === "rateLimit" ? MAX_RATE_LIMIT_ATTEMPTS : MAX_ATTEMPTS;
      if (!retryOn.includes(apiError.kind) || attempt >= maxAttempts) throw apiError;
      await wait(retryDelayMs(apiError, attempt), signal);
      if (signal?.aborted) throw new TtsApiError("aborted", "The request was cancelled.");
    }
  }
}

// ---------------------------------------------------------------------------
// Response parsing (API data is untrusted, so every field is checked)
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
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

function invalidResponse(message: string): TtsApiError {
  return new TtsApiError("invalidResponse", message);
}

function normalizeStatus(value: unknown): JobStatus | undefined {
  switch (typeof value === "string" ? value.toLowerCase() : "") {
    case "queued":
    case "pending":
      return "queued";
    case "processing":
    case "running":
    case "started":
      return "processing";
    case "completed":
    case "complete":
    case "done":
    case "success":
    case "succeeded":
      return "completed";
    case "failed":
    case "error":
    case "cancelled":
    case "canceled":
      return "failed";
    default:
      return undefined;
  }
}

function parseVoices(data: unknown): Voice[] {
  if (typeof data === "string") throw invalidResponse(PROXY_HINT);
  const list = asArray(data) ?? (isRecord(data) ? asArray(data.voices) : undefined);
  if (!list) throw invalidResponse("TTS.ai sent the voice list in an unexpected format.");

  const voices = new Map<string, Voice>();
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const id = readString(entry, "id", "voice_id");
    if (!id) continue;
    const model = readString(entry, "model");
    const key = model ? `${model}:${id}` : id;
    if (voices.has(key)) continue;
    voices.set(key, {
      key,
      id,
      name: readString(entry, "name") ?? id,
      language: readString(entry, "language", "lang") ?? "",
      model,
      gender: readString(entry, "gender"),
    });
  }
  // In TTS.ai's order; the Sort voices checkboxes decide how lists are sorted.
  return [...voices.values()];
}

export interface SubmittedJob {
  jobId: string;
  status: JobStatus;
  /** Credits charged for this job; 0 when TTS.ai reused audio it had already made. */
  creditsUsed?: number;
  /** TTS.ai's reported balance. Missing on reused audio, and it doesn't always drop right away. */
  creditsRemaining?: number;
}

function parseSubmittedJob(data: unknown): SubmittedJob {
  if (!isRecord(data)) throw invalidResponse("TTS.ai sent an unexpected reply when submitting a job.");
  // The results endpoint is keyed by `uuid`; `job_id` is only a fallback.
  const jobId = readString(data, "uuid", "job_id");
  if (!jobId) throw invalidResponse("TTS.ai accepted the request but didn't return a job ID.");
  return {
    jobId,
    status: normalizeStatus(data.status) ?? "queued",
    creditsUsed: readNumber(data, "credits_used"),
    creditsRemaining: readNumber(data, "credits_remaining"),
  };
}

export type JobStatusResult =
  | { status: "queued" | "processing" }
  | { status: "completed"; resultUrl: string }
  | { status: "failed"; error?: string };

function parseJobStatus(data: unknown): JobStatusResult {
  if (!isRecord(data)) throw invalidResponse("TTS.ai sent an unexpected job status.");
  const status = normalizeStatus(data.status) ?? "processing";
  if (status === "completed") {
    const resultUrl = readString(data, "result_url", "url", "audio_url");
    return resultUrl
      ? { status, resultUrl }
      : { status: "failed", error: "TTS.ai finished the job but didn't provide an audio file." };
  }
  if (status === "failed") return { status, error: readString(data, "error", "message") };
  return { status };
}

function parseAudioBlob(data: unknown): Blob {
  if (!(data instanceof Blob) || data.size === 0) {
    throw invalidResponse("The audio file from TTS.ai was empty or missing.");
  }
  if (data.type.includes("text/html")) throw invalidResponse(PROXY_HINT);
  return data;
}

/** Sends TTS.ai-hosted URLs through API_ORIGIN (the dev proxy by default) to avoid CORS. */
function routeThroughApiOrigin(url: string): string {
  if (url.startsWith(`${TTS_UPSTREAM_ORIGIN}/`)) {
    return API_ORIGIN + url.slice(TTS_UPSTREAM_ORIGIN.length);
  }
  return url.startsWith("/") ? API_ORIGIN + url : url;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getVoices(signal?: AbortSignal): Promise<Voice[]> {
  return send(apiClient, { method: "GET", url: "/voices/" }, parseVoices, {
    signal,
    retryOn: READ_RETRY,
  });
}

export interface SubmitJobRequest {
  text: string;
  voice: Voice;
  speed: number;
}

export function submitJob(
  { text, voice, speed }: SubmitJobRequest,
  signal?: AbortSignal,
): Promise<SubmittedJob> {
  const language = primaryLanguage(voice.language);
  return send(
    apiClient,
    {
      method: "POST",
      url: "/tts/",
      data: {
        text,
        voice: voice.id,
        model: voice.model,
        speed,
        format: "mp3",
        // Short vocabulary items are hard to auto-detect, so pass the voice's language.
        language: language || undefined,
      },
    },
    parseSubmittedJob,
    { signal, retryOn: SUBMIT_RETRY },
  );
}

export function getJobStatus(jobId: string, signal?: AbortSignal): Promise<JobStatusResult> {
  return send(
    apiClient,
    { method: "GET", url: "/speech/results/", params: { uuid: jobId } },
    parseJobStatus,
    { signal, retryOn: READ_RETRY },
  );
}

export function downloadAudio(url: string, signal?: AbortSignal): Promise<Blob> {
  return send(
    downloadClient,
    { method: "GET", url: routeThroughApiOrigin(url), responseType: "blob" },
    parseAudioBlob,
    { signal, retryOn: READ_RETRY },
  );
}
