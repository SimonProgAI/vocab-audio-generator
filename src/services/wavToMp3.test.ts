import { describe, expect, it } from "vitest";
import { encodeMp3, readWav, wavToMp3 } from "./wavToMp3";

interface WavOptions {
  format?: number;
  bits?: number;
  channels?: number;
  sampleRate?: number;
  /** Interleaved samples: integers for PCM, -1…1 floats for format 3. */
  samples: number[];
  /** Write a WAVE_FORMAT_EXTENSIBLE header whose sub-format is `format`. */
  extensible?: boolean;
  /** Put an odd-sized LIST chunk (with its pad byte) before fmt and data. */
  listChunk?: boolean;
  /** Leave the data chunk out. */
  noData?: boolean;
}

/** Builds a WAV file in memory, the way TTS.ai's models write them. */
function wav({ format = 1, bits = 16, channels = 1, sampleRate = 22050, samples, extensible = false, listChunk = false, noData = false }: WavOptions): ArrayBuffer {
  const bytesPerSample = bits / 8;
  const fmtSize = extensible ? 40 : 16;
  const dataSize = noData ? 0 : samples.length * bytesPerSample;
  const listSize = listChunk ? 8 + 3 + 1 : 0;
  const buffer = new ArrayBuffer(12 + listSize + 8 + fmtSize + (noData ? 0 : 8 + dataSize));
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, "WAVE");
  let offset = 12;
  if (listChunk) {
    text(offset, "LIST");
    view.setUint32(offset + 4, 3, true);
    offset += 8 + 3 + 1;
  }
  text(offset, "fmt ");
  view.setUint32(offset + 4, fmtSize, true);
  view.setUint16(offset + 8, extensible ? 0xfffe : format, true);
  view.setUint16(offset + 10, channels, true);
  view.setUint32(offset + 12, sampleRate, true);
  view.setUint32(offset + 16, sampleRate * channels * bytesPerSample, true);
  view.setUint16(offset + 20, channels * bytesPerSample, true);
  view.setUint16(offset + 22, bits, true);
  if (extensible) {
    view.setUint16(offset + 24, 22, true);
    view.setUint16(offset + 32, format, true);
  }
  offset += 8 + fmtSize;
  if (noData) return buffer;
  text(offset, "data");
  view.setUint32(offset + 4, dataSize, true);
  samples.forEach((sample, i) => {
    const at = offset + 8 + i * bytesPerSample;
    if (format === 3) view.setFloat32(at, sample, true);
    else if (bits === 16) view.setInt16(at, sample, true);
    else view.setUint8(at, sample);
  });
  return buffer;
}

/** A second-long 440 Hz tone. */
function tone(sampleRate: number, seconds = 1): number[] {
  return Array.from({ length: Math.round(sampleRate * seconds) }, (_, i) => Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12_000));
}

/** Duration of MPEG Layer III audio, from its frame headers. */
function mp3Seconds(bytes: Uint8Array): number {
  const bitrates = { mpeg1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], mpeg2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
  const rates: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  let seconds = 0;
  for (let i = 0; i + 4 <= bytes.length; ) {
    const [a = 0, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const version = (b >> 3) & 3;
    const rateIndex = (c >> 2) & 3;
    const bitrateIndex = c >> 4;
    if (a !== 0xff || (b & 0xe0) !== 0xe0 || version === 1 || ((b >> 1) & 3) !== 1 || rateIndex === 3 || bitrateIndex === 0 || bitrateIndex === 15) {
      i += 1;
      continue;
    }
    const rate = rates[version]?.[rateIndex] ?? 1;
    const samples = version === 3 ? 1152 : 576;
    const kbps = (version === 3 ? bitrates.mpeg1 : bitrates.mpeg2)[bitrateIndex] ?? 0;
    seconds += samples / rate;
    i += Math.floor(((samples / 8) * kbps * 1000) / rate) + ((c >> 1) & 1);
  }
  return seconds;
}

describe("readWav", () => {
  it("reads 16-bit PCM, like piper and vits send", () => {
    expect(readWav(wav({ samples: [0, 1000, -1000, 32767] }))).toEqual({
      channels: [Int16Array.from([0, 1000, -1000, 32767])],
      sampleRate: 22050,
    });
  });

  it("reads 32-bit float, like bark-small sends", () => {
    const { channels, sampleRate } = readWav(wav({ format: 3, bits: 32, sampleRate: 24000, samples: [0, 0.5, -0.5, 1] }));
    expect(sampleRate).toBe(24000);
    expect([...(channels[0] ?? [])]).toEqual([0, 16384, -16383, 32767]);
  });

  it("turns down float audio that goes past ±1.0 instead of clipping it", () => {
    const { channels } = readWav(wav({ format: 3, bits: 32, samples: [0.5, -1, 2] }));
    // Halved to fit: 0.25, -0.5 and 1.0 of full scale.
    expect([...(channels[0] ?? [])]).toEqual([8192, -16383, 32767]);
  });

  it("splits stereo into two channels", () => {
    const { channels } = readWav(wav({ channels: 2, samples: [1, -1, 2, -2] }));
    expect(channels.map((channel) => [...channel])).toEqual([
      [1, 2],
      [-1, -2],
    ]);
  });

  it("reads the extensible header some tools write", () => {
    expect([...(readWav(wav({ extensible: true, samples: [5, 6] })).channels[0] ?? [])]).toEqual([5, 6]);
  });

  it("skips chunks it doesn't need, including their pad byte", () => {
    expect([...(readWav(wav({ listChunk: true, samples: [7, 8] })).channels[0] ?? [])]).toEqual([7, 8]);
  });

  it("refuses files it can't read", () => {
    expect(() => readWav(new Uint8Array([0xff, 0xfb, 0x90, 0x00]).buffer)).toThrow("Not a WAV file.");
    expect(() => readWav(wav({ samples: [], noData: true }))).toThrow("The WAV file has no audio data.");
    expect(() => readWav(wav({ bits: 8, samples: [128, 129] }))).toThrow("Unsupported WAV format (code 1, 8-bit).");
  });
});

describe("encodeMp3", () => {
  it("makes real MP3 frames of about the same length", async () => {
    const mp3 = encodeMp3(readWav(wav({ samples: tone(22050) })));
    const bytes = new Uint8Array(await mp3.arrayBuffer());
    expect(mp3.type).toBe("audio/mpeg");
    expect(bytes[0]).toBe(0xff);
    expect((bytes[1] ?? 0) & 0xe0).toBe(0xe0);
    expect(mp3Seconds(bytes)).toBeGreaterThan(0.95);
    expect(mp3Seconds(bytes)).toBeLessThan(1.15);
  });

  it("encodes stereo too", async () => {
    const left = tone(24000, 0.5);
    const interleaved = left.flatMap((sample) => [sample, -sample]);
    const mp3 = encodeMp3(readWav(wav({ channels: 2, sampleRate: 24000, samples: interleaved })));
    expect(mp3Seconds(new Uint8Array(await mp3.arrayBuffer()))).toBeGreaterThan(0.45);
  });
});

describe("wavToMp3", () => {
  it("turns a WAV blob into an MP3 blob", async () => {
    const mp3 = await wavToMp3(new Blob([wav({ format: 3, bits: 32, sampleRate: 24000, samples: tone(24000).map((v) => v / 12_000) })]));
    expect(mp3.type).toBe("audio/mpeg");
    expect(mp3.size).toBeGreaterThan(1000);
  });
});
