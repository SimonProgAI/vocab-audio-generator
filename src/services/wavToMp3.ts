import { Mp3Encoder } from "@breezystack/lamejs";

/** Plenty for speech, and keeps vocabulary files small. */
const KBPS = 64;
/** One MP3 frame's worth of samples per encoder call. */
const CHUNK_SAMPLES = 1152;

const PCM = 1;
const IEEE_FLOAT = 3;
const EXTENSIBLE = 0xfffe;

export interface Pcm {
  /** 16-bit samples, one array per channel (at most two are kept). */
  channels: Int16Array[];
  sampleRate: number;
}

function tag(view: DataView, offset: number): string {
  return String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset, 4));
}

function decode(view: DataView, start: number, length: number, format: number, channelCount: number, bits: number): Int16Array[] {
  const bytesPerSample = bits / 8;
  const frames = Math.floor(length / (bytesPerSample * channelCount));
  const kept = Math.min(channelCount, 2);
  const at = (frame: number, channel: number) => start + (frame * channelCount + channel) * bytesPerSample;

  // Float audio can go past ±1.0 (bark-small peaks around 1.7). Clipping that to 16 bits distorts
  // it badly enough to change what is heard, so the whole clip is turned down to fit instead.
  let gain = 1;
  if (format === IEEE_FLOAT) {
    let peak = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < kept; channel += 1) peak = Math.max(peak, Math.abs(view.getFloat32(at(frame, channel), true)));
    }
    if (peak > 1) gain = 1 / peak;
  }

  const channels = Array.from({ length: kept }, () => new Int16Array(frames));
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < kept; channel += 1) {
      const sample =
        format === PCM
          ? view.getInt16(at(frame, channel), true)
          : Math.round(Math.max(-1, Math.min(1, view.getFloat32(at(frame, channel), true) * gain)) * 0x7fff);
      (channels[channel] as Int16Array)[frame] = sample;
    }
  }
  return channels;
}

/**
 * Reads the WAV files TTS.ai sends: 16-bit integer PCM (piper, vits) and 32-bit float (bark-small).
 * Other sample formats throw.
 */
export function readWav(bytes: ArrayBuffer): Pcm {
  const view = new DataView(bytes);
  if (view.byteLength < 12 || tag(view, 0) !== "RIFF" || tag(view, 8) !== "WAVE") throw new Error("Not a WAV file.");
  let format = 0;
  let channelCount = 0;
  let sampleRate = 0;
  let bits = 0;
  for (let offset = 12; offset + 8 <= view.byteLength; ) {
    const id = tag(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channelCount = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE keeps the real format code at the start of its sub-format GUID.
      if (format === EXTENSIBLE && size >= 26) format = view.getUint16(body + 24, true);
    }
    if (id === "data") {
      const supported = (format === PCM && bits === 16) || (format === IEEE_FLOAT && bits === 32);
      if (!supported || channelCount < 1 || sampleRate <= 0) {
        throw new Error(`Unsupported WAV format (code ${format}, ${bits}-bit).`);
      }
      const length = Math.min(size, view.byteLength - body);
      return { channels: decode(view, body, length, format, channelCount, bits), sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("The WAV file has no audio data.");
}

export function encodeMp3({ channels, sampleRate }: Pcm): Blob {
  const [left = new Int16Array(0), right] = channels;
  const encoder = new Mp3Encoder(right ? 2 : 1, sampleRate, KBPS);
  const parts: BlobPart[] = [];
  for (let start = 0; start < left.length; start += CHUNK_SAMPLES) {
    const end = start + CHUNK_SAMPLES;
    const chunk = encoder.encodeBuffer(left.subarray(start, end), right?.subarray(start, end));
    if (chunk.length > 0) parts.push(new Uint8Array(chunk));
  }
  const last = encoder.flush();
  if (last.length > 0) parts.push(new Uint8Array(last));
  return new Blob(parts, { type: "audio/mpeg" });
}

export async function wavToMp3(wav: Blob): Promise<Blob> {
  return encodeMp3(readWav(await wav.arrayBuffer()));
}
