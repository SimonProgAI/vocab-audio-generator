import { useCallback, useEffect, useMemo, useState } from "react";
import { getVoices, toTtsApiError } from "../services/ttsApi";
import type { Voice } from "../types/queue";
import { isHiddenVoice } from "../utils/voices";

export type VoiceLoadStatus = "loading" | "ready" | "error";

interface VoicesState {
  status: VoiceLoadStatus;
  voices: Voice[];
  error?: string;
}

export function useVoices() {
  const [state, setState] = useState<VoicesState>({ status: "loading", voices: [] });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getVoices(controller.signal)
      .then((all) => all.filter((voice) => !isHiddenVoice(voice)))
      .then((voices) =>
        setState(
          voices.length > 0
            ? { status: "ready", voices }
            : { status: "error", voices: [], error: "TTS.ai returned an empty voice list." },
        ),
      )
      .catch((error: unknown) => {
        const apiError = toTtsApiError(error);
        if (apiError.kind === "aborted") return;
        setState({ status: "error", voices: [], error: `Couldn't load voices. ${apiError.message}` });
      });
    return () => controller.abort();
  }, [attempt]);

  const reload = useCallback(() => {
    setState({ status: "loading", voices: [] });
    setAttempt((count) => count + 1);
  }, []);

  const voicesByKey = useMemo(
    () => new Map(state.voices.map((voice) => [voice.key, voice])),
    [state.voices],
  );

  return { ...state, voicesByKey, reload };
}
