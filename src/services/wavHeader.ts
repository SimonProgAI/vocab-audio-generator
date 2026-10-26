/**
 * WAV files start with "RIFF", four size bytes, then "WAVE". Kept apart from the encoder so the
 * audio loader can check files without loading it.
 */
export function isWavHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const text = (from: number) => String.fromCharCode(...bytes.subarray(from, from + 4));
  return text(0) === "RIFF" && text(8) === "WAVE";
}
