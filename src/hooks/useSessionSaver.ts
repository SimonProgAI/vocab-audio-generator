import { useEffect, useRef } from "react";
import { saveSession, type SessionSnapshot } from "../services/session";

/** Long enough to cover a burst of typing, short enough that little is lost if the tab crashes. */
export const SAVE_DELAY_MS = 250;

/**
 * Saves the session a moment after it stops changing, instead of serializing the whole queue on
 * every keystroke or progress update. Anything still unsaved is written right away when the page
 * is hidden or unloaded (a refresh fires `pagehide`) and when the app unmounts.
 * `snapshot` should be memoized: a new object counts as a change.
 */
export function useSessionSaver(snapshot: SessionSnapshot): void {
  const latest = useRef(snapshot);
  const dirty = useRef(false);

  useEffect(() => {
    latest.current = snapshot;
    dirty.current = true;
    const timer = window.setTimeout(() => {
      saveSession(snapshot);
      dirty.current = false;
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [snapshot]);

  useEffect(() => {
    const flush = () => {
      if (!dirty.current) return;
      saveSession(latest.current);
      dirty.current = false;
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
}
