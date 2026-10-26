import { wavToMp3 } from "./wavToMp3";

/**
 * Converts WAV to MP3 off the main thread (see toMp3 in audio.ts), so building a big ZIP doesn't
 * freeze the page. One request per message: { id, wav } in, { id, mp3 } or { id, error } out.
 */
interface ConvertRequest {
  id: number;
  wav: ArrayBuffer;
}

// The app's TypeScript setup types `self` as a window; in a worker it is the worker's own scope.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ConvertRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = async ({ data: { id, wav } }) => {
  try {
    const mp3 = await (await wavToMp3(new Blob([wav]))).arrayBuffer();
    scope.postMessage({ id, mp3 }, [mp3]);
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
