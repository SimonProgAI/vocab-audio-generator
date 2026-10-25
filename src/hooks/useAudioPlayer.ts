import { useCallback, useEffect, useRef, useState } from "react";

export type PlaybackState = "loading" | "playing";

export interface Playback {
  /** Whatever the caller passed to play(), e.g. a queue row's id. */
  id: string;
  state: PlaybackState;
}

/**
 * Plays one clip at a time: starting a clip stops the previous one. `play` resolves once playback
 * starts (or was stopped first) and rejects if loading or playing fails. `load` gets a signal that
 * aborts when the clip is stopped or replaced before it has loaded.
 */
export function useAudioPlayer() {
  const [current, setCurrent] = useState<Playback | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const loadControllerRef = useRef<AbortController | null>(null);
  // Bumped by every play() and stop(), so a slow load can tell it has been superseded.
  const generationRef = useRef(0);

  const stop = useCallback(() => {
    generationRef.current += 1;
    loadControllerRef.current?.abort();
    loadControllerRef.current = null;
    audioRef.current?.pause();
    audioRef.current = null;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setCurrent(null);
  }, []);

  const play = useCallback(
    async (id: string, load: (signal: AbortSignal) => Promise<Blob>) => {
      stop();
      const generation = generationRef.current;
      const isCurrent = () => generation === generationRef.current;
      const controller = new AbortController();
      loadControllerRef.current = controller;
      setCurrent({ id, state: "loading" });
      try {
        const blob = await load(controller.signal);
        if (!isCurrent()) return;
        loadControllerRef.current = null;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        objectUrlRef.current = url;
        // "pause" also covers the end of the clip and pauses from outside the page (media keys,
        // the OS media controls); "error" covers a clip that breaks partway through.
        const finish = () => {
          if (isCurrent()) stop();
        };
        audio.addEventListener("pause", finish);
        audio.addEventListener("ended", finish);
        audio.addEventListener("error", finish);
        await audio.play();
        if (isCurrent()) setCurrent({ id, state: "playing" });
      } catch (error) {
        if (!isCurrent()) return;
        stop();
        // Browsers can refuse sound that starts long after the click (e.g. after a slow sample).
        // The audio is cached by then, so a second click plays it right away.
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          throw new Error("Your browser blocked playback. Click again to play it.");
        }
        throw error;
      }
    },
    [stop],
  );

  useEffect(() => stop, [stop]);

  return { current, play, stop };
}
