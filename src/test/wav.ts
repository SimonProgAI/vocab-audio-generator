/** Test helpers: WAV files built in memory, the way TTS.ai's models write them. */

export interface WavOptions {
  /** 1 = integer PCM, 3 = IEEE float. */
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
  /** Write this as the data chunk's size instead of the real one (streaming writers leave 0). */
  declaredDataSize?: number;
}

export function wavFile({
  format = 1,
  bits = 16,
  channels = 1,
  sampleRate = 22050,
  samples,
  extensible = false,
  listChunk = false,
  noData = false,
  declaredDataSize,
}: WavOptions): ArrayBuffer {
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
  view.setUint32(offset + 4, declaredDataSize ?? dataSize, true);
  samples.forEach((sample, i) => {
    const at = offset + 8 + i * bytesPerSample;
    if (format === 3) view.setFloat32(at, sample, true);
    else if (bits === 16) view.setInt16(at, sample, true);
    else view.setUint8(at, sample);
  });
  return buffer;
}

/** A 440 Hz tone, as 16-bit samples (or -1…1 floats with `float`). */
export function tone(sampleRate: number, seconds = 1, { float = false } = {}): number[] {
  return Array.from({ length: Math.round(sampleRate * seconds) }, (_, i) => {
    const value = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.4;
    return float ? value : Math.round(value * 30_000);
  });
}

/** A short piper-like WAV clip as a Blob. */
export function wavBlob({ seconds = 0.2, bits = 16, type }: { seconds?: number; bits?: number; type?: string } = {}): Blob {
  const samples = bits === 16 ? tone(22050, seconds) : Array.from({ length: Math.round(22050 * seconds) }, () => 128);
  return new Blob([wavFile({ bits, samples })], type ? { type } : {});
}
