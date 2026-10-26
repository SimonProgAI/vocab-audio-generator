import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tone, wavFile } from "../test/wav";
import { isWavHeader } from "./wavHeader";

/** Stands in for the worker's own scope (`self`), recording what the worker posts back. */
interface FakeScope {
  onmessage: ((event: { data: { id: number; wav: ArrayBuffer } }) => Promise<void>) | null;
  posted: Array<{ message: { id: number; mp3?: ArrayBuffer; error?: string }; transfer?: unknown[] }>;
  postMessage(message: { id: number; mp3?: ArrayBuffer; error?: string }, transfer?: unknown[]): void;
}

let scope: FakeScope;

beforeEach(async () => {
  vi.resetModules();
  scope = {
    onmessage: null,
    posted: [],
    postMessage(message, transfer) {
      this.posted.push({ message, transfer });
    },
  };
  vi.stubGlobal("self", scope);
  await import("./mp3Worker");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mp3Worker", () => {
  it("answers a WAV with an MP3 under the same id, handing the bytes over without copying", async () => {
    await scope.onmessage?.({ data: { id: 7, wav: wavFile({ samples: tone(22050, 0.3) }) } });
    const [reply] = scope.posted;
    expect(reply?.message.id).toBe(7);
    const mp3 = new Uint8Array(reply?.message.mp3 ?? new ArrayBuffer(0));
    expect(mp3[0]).toBe(0xff);
    expect(isWavHeader(mp3)).toBe(false);
    expect(reply?.transfer).toEqual([reply?.message.mp3]);
  });

  it("answers with the reason when the WAV can't be converted", async () => {
    await scope.onmessage?.({ data: { id: 8, wav: wavFile({ bits: 8, samples: [128, 129] }) } });
    expect(scope.posted.map((reply) => reply.message)).toEqual([{ id: 8, error: "Unsupported WAV format (code 1, 8-bit)." }]);
  });
});
