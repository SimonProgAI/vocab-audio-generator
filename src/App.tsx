import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiKeySettings } from "./components/ApiKeySettings";
import { BulkImport } from "./components/BulkImport";
import { Button } from "./components/Button";
import { Notice, type NoticeContent } from "./components/Notice";
import { ProgressPanel } from "./components/ProgressPanel";
import { QueueTable } from "./components/QueueTable";
import { SpeakerSettings } from "./components/SpeakerSettings";
import { Toolbar } from "./components/Toolbar";
import { useAudioPlayer } from "./hooks/useAudioPlayer";
import { useSessionSaver } from "./hooks/useSessionSaver";
import { type GenerationSummary, type ResumedJob, useGeneration } from "./hooks/useGeneration";
import { useQueue } from "./hooks/useQueue";
import { useVoices } from "./hooks/useVoices";
import { isUpToDate, planGeneration } from "./services/assignment";
import { EXPIRED_AUDIO_MESSAGE, isExpiredAudioError, loadAudio, retainAudio } from "./services/audio";
import {
  ZIP_FILENAME,
  downloadAllCompleted,
  downloadItem,
  toMp3Name,
  type ZipProgress,
} from "./services/download";
import { loadSession, type RestoredSession, type SessionSnapshot } from "./services/session";
import { BUILT_IN_API_KEY, forgetApiKey, loadApiKey, saveApiKey } from "./services/apiKey";
import { getErrorMessage, type SubmittedJob } from "./services/ttsApi";
import { clearVoiceSamples, loadVoiceSample } from "./services/voiceSample";
import type { QueueItem, SpeakerConfig, Voice } from "./types/queue";
import { NO_CREDITS_USED, recordCredits, type CreditUsage } from "./utils/credits";
import { pluralize } from "./utils/format";
import { DEFAULT_SPEED, effectiveSpeed } from "./utils/speed";
import {
  DEFAULT_VOICE_LIST,
  arrangeVoiceList,
  defaultLanguage,
  matchesLanguage,
  passesFilters,
  summarizeLanguages,
  type VoiceListOptions,
} from "./utils/voices";

function summarizeRun({ completed, failed, stoppedByUser, fatalError }: GenerationSummary): NoticeContent {
  if (fatalError) {
    return { tone: "error", title: "Generation stopped", messages: [fatalError] };
  }
  if (stoppedByUser) {
    return {
      tone: "info",
      title: "Generation stopped",
      messages: [
        `${pluralize(completed, "file")} finished before you stopped. Unfinished files are back to Pending — click Generate All to continue.`,
      ],
    };
  }
  if (failed > 0) {
    return {
      tone: "warning",
      title: `${pluralize(completed, "file")} generated, ${failed} failed`,
      messages: ["The Status column explains each failure. Click Generate All to retry the failed files."],
    };
  }
  return {
    tone: "success",
    title: `${pluralize(completed, "file")} generated`,
    messages: ["Download files one by one, or all at once with Download All (ZIP)."],
  };
}

function restoredNotice(session: RestoredSession | undefined): NoticeContent | null {
  if (!session || session.items.length === 0) return null;
  const { items, interrupted } = session;
  return {
    tone: "info",
    title: "Queue restored",
    messages: [
      `Your ${pluralize(items.length, "file")} and settings were kept when the page reloaded.`,
      ...(interrupted > 0
        ? [
            `${pluralize(interrupted, "file")} ${interrupted === 1 ? "was" : "were"} still generating. The app is checking on ${interrupted === 1 ? "that job" : "those jobs"} again instead of paying for new ones.`,
          ]
        : []),
    ],
  };
}

const DEFAULT_CONFIG: SpeakerConfig = { mode: "single", selectedVoices: [] };

/** Restored rows that were generating, as jobs to poll again (see parseSession). */
function resumableJobs(items: readonly QueueItem[], globalSpeed: number): ResumedJob[] {
  return items.flatMap((item): ResumedJob[] =>
    (item.status === "queued" || item.status === "processing") && item.jobId && item.speaker
      ? [
          {
            itemId: item.id,
            jobId: item.jobId,
            status: item.status,
            generatedWith: { speaker: item.speaker, speed: effectiveSpeed(item, globalSpeed) },
          },
        ]
      : [],
  );
}

export default function App() {
  // Read once: the queue and settings from before a reload in this tab, if any.
  const [saved] = useState(loadSession);
  const { items, stats, actions } = useQueue(saved?.items);
  const voiceLibrary = useVoices();
  const [credits, setCredits] = useState<CreditUsage>(saved?.credits ?? NO_CREDITS_USED);
  const recordSubmitted = useCallback(
    (job: SubmittedJob) => setCredits((usage) => recordCredits(usage, job)),
    [],
  );
  const generation = useGeneration(actions.applyProgress, recordSubmitted);
  const { current: playback, play, stop: stopPlayback } = useAudioPlayer();
  const [apiKey, setApiKey] = useState(loadApiKey);

  const [config, setConfig] = useState<SpeakerConfig>(saved?.settings.config ?? DEFAULT_CONFIG);
  const [globalSpeed, setGlobalSpeed] = useState(saved?.settings.globalSpeed ?? DEFAULT_SPEED);
  const [languageChoice, setLanguageChoice] = useState<string | null>(saved?.settings.languageChoice ?? null);
  const [voiceList, setVoiceList] = useState<VoiceListOptions>(saved?.settings.voiceList ?? DEFAULT_VOICE_LIST);
  const [draft, setDraft] = useState(saved?.draft ?? "");
  const [notice, setNotice] = useState<NoticeContent | null>(() => restoredNotice(saved));
  // Settings are locked while generating, so the saved speed is the one these jobs were sent with.
  const [resumable] = useState(() => (saved ? resumableJobs(saved.items, saved.settings.globalSpeed ?? DEFAULT_SPEED) : []));
  const resumedRef = useRef(false);

  // Pick restored jobs back up once, after the voice list has answered. Waiting also keeps this out
  // of React's development double mount, whose simulated unmount would abort the run.
  useEffect(() => {
    if (resumedRef.current || resumable.length === 0 || voiceLibrary.status === "loading") return;
    resumedRef.current = true;
    void generation.run([], resumable).then((summary) => setNotice(summarizeRun(summary)));
  }, [resumable, voiceLibrary.status, generation.run]);
  const [zipProgress, setZipProgress] = useState<ZipProgress | null>(null);

  const snapshot = useMemo<SessionSnapshot>(
    () => ({ items, draft, settings: { config, globalSpeed, languageChoice, voiceList }, credits }),
    [items, draft, config, globalSpeed, languageChoice, voiceList, credits],
  );
  useSessionSaver(snapshot);

  // Keep only the audio files rows still link to; removed, cleared or regenerated rows free theirs.
  useEffect(() => {
    retainAudio(new Set(items.flatMap((item) => (item.downloadUrl ? [item.downloadUrl] : []))));
  }, [items]);

  const languages = useMemo(
    () => summarizeLanguages(voiceLibrary.voices, (voice) => passesFilters(voice, voiceList)),
    [voiceLibrary.voices, voiceList],
  );
  const language = languageChoice ?? defaultLanguage(languages);
  const visibleVoices = useMemo(
    () => voiceLibrary.voices.filter((voice) => matchesLanguage(voice, language)),
    [voiceLibrary.voices, language],
  );
  // Arranged once here and shared, rather than sorted again by every picker on every render.
  const arrangedVoices = useMemo(() => arrangeVoiceList(visibleVoices, voiceList), [visibleVoices, voiceList]);
  const outdatedIds = useMemo(
    () =>
      new Set(
        items
          .filter((item, index) => item.status === "completed" && !isUpToDate(item, index, config, globalSpeed))
          .map((item) => item.id),
      ),
    [items, config, globalSpeed],
  );

  const handleGenerate = async () => {
    const plan = planGeneration(items, config, globalSpeed, voiceLibrary.voicesByKey);
    if (!plan.ok) {
      setNotice({ tone: "error", title: "Can't start generating yet", messages: plan.errors });
      return;
    }
    if (plan.jobs.length === 0) {
      setNotice({ tone: "info", messages: ["Every file is already generated with the current settings."] });
      return;
    }
    setNotice(null);
    setNotice(summarizeRun(await generation.run(plan.jobs)));
  };

  // An expired link can't be fixed by retrying, so the row fails and Generate All makes it again.
  const reportAudioError = useCallback(
    (item: QueueItem, action: "download" | "play", error: unknown) => {
      const expired = isExpiredAudioError(error);
      if (expired && item.downloadUrl) actions.expire(item.id, item.downloadUrl, EXPIRED_AUDIO_MESSAGE);
      setNotice({
        tone: "error",
        title: `Couldn't ${action} ${toMp3Name(item.filename)}`,
        messages: [expired ? EXPIRED_AUDIO_MESSAGE : getErrorMessage(error)],
      });
    },
    [actions],
  );

  const handleDownload = useCallback(
    async (item: QueueItem) => {
      try {
        await downloadItem(item);
        if (item.downloadUrl) actions.markDownloaded([{ id: item.id, url: item.downloadUrl }]);
      } catch (error) {
        reportAudioError(item, "download", error);
      }
    },
    [actions, reportAudioError],
  );

  const handlePlay = useCallback(
    async (item: QueueItem) => {
      const url = item.downloadUrl;
      if (!url) return;
      try {
        await play(item.id, () => loadAudio(url));
      } catch (error) {
        reportAudioError(item, "play", error);
      }
    },
    [play, reportAudioError],
  );

  const handleSample = useCallback(
    async (item: QueueItem, voice: Voice) => {
      try {
        await play(item.id, (signal) => loadVoiceSample(voice, { signal, onSubmitted: recordSubmitted }));
      } catch (error) {
        setNotice({ tone: "error", title: `Couldn't play a sample of ${voice.name}`, messages: [getErrorMessage(error)] });
      }
    },
    [play, recordSubmitted],
  );

  // Stop a clip whose row was removed, cleared or reset away.
  useEffect(() => {
    if (playback && !items.some((item) => item.id === playback.id)) stopPlayback();
  }, [items, playback, stopPlayback]);

  const handleDownloadAll = async () => {
    try {
      const result = await downloadAllCompleted(items, setZipProgress);
      for (const { id, url } of result.expired) actions.expire(id, url, EXPIRED_AUDIO_MESSAGE);
      actions.markDownloaded(result.saved);
      const expiredNote =
        result.expired.length > 0
          ? [
              `${pluralize(result.expired.length, "file")} had an expired audio link and ${result.expired.length === 1 ? "is" : "are"} now marked Failed. Click Generate All to make ${result.expired.length === 1 ? "it" : "them"} again.`,
            ]
          : [];
      if (result.added === 0) {
        setNotice({
          tone: "error",
          title: "Couldn't create the ZIP file",
          messages: [
            "None of the audio files could be downloaded. Check your connection and try again.",
            ...expiredNote,
          ],
        });
      } else if (result.skipped.length > 0) {
        setNotice({
          tone: "warning",
          title: `${ZIP_FILENAME} saved with ${pluralize(result.added, "file")}`,
          messages: [
            `${pluralize(result.skipped.length, "file")} couldn't be downloaded and ${result.skipped.length === 1 ? "was" : "were"} left out: ${result.skipped.join(", ")}`,
            ...expiredNote,
          ],
        });
      } else {
        setNotice(null);
      }
    } catch (error) {
      setNotice({ tone: "error", title: "Couldn't create the ZIP file", messages: [getErrorMessage(error)] });
    } finally {
      setZipProgress(null);
    }
  };

  // The key isn't part of the work, so Reset leaves it alone; Forget is the way to remove it.
  const handleSaveKey = (key: string, remember: boolean) => {
    saveApiKey(key, remember);
    setApiKey(loadApiKey());
    if (voiceLibrary.status === "error") voiceLibrary.reload();
  };

  const handleForgetKey = () => {
    forgetApiKey();
    setApiKey(undefined);
  };

  const handleClear = () => {
    if (window.confirm(`Remove all ${pluralize(items.length, "file")} from the queue?`)) {
      actions.clear();
      setNotice(null);
    }
  };

  // Start over: an empty queue, an empty Bulk Import box and default settings, like a first visit.
  // The save effect then stores that blank state, so reloading afterwards stays blank too.
  const handleReset = () => {
    const removed = [
      ...(items.length === 1 ? ["the 1 file in the queue"] : []),
      ...(items.length > 1 ? [`all ${items.length} files from the queue`] : []),
      ...(draft.trim() ? ["the text in Bulk Import"] : []),
    ];
    const question =
      removed.length > 0
        ? `Start over? This resets every setting and removes ${removed.join(" and ")}.`
        : "Reset every setting to its default?";
    if (!window.confirm(question)) return;
    actions.clear();
    setDraft("");
    setConfig(DEFAULT_CONFIG);
    setGlobalSpeed(DEFAULT_SPEED);
    setLanguageChoice(null);
    setVoiceList(DEFAULT_VOICE_LIST);
    setCredits(NO_CREDITS_USED);
    clearVoiceSamples();
    setNotice(null);
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-5">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path strokeLinecap="round" d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
            </svg>
          </span>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">French Vocabulary Audio Generator</h1>
            <p className="text-sm text-slate-500">Turn vocabulary lists into MP3 recordings with TTS.ai.</p>
          </div>
          <Button
            onClick={handleReset}
            disabled={generation.isGenerating || zipProgress !== null}
            title="Clear the queue and restore the default settings"
            className="ml-auto"
          >
            Reset
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <ApiKeySettings
          saved={apiKey}
          hasBuiltInKey={BUILT_IN_API_KEY !== ""}
          onSave={handleSaveKey}
          onForget={handleForgetKey}
        />

        <BulkImport draft={draft} onDraftChange={setDraft} onAdd={actions.addTexts} />

        <SpeakerSettings
          voiceStatus={voiceLibrary.status}
          voiceError={voiceLibrary.error}
          onRetryVoices={voiceLibrary.reload}
          arranged={arrangedVoices}
          voicesByKey={voiceLibrary.voicesByKey}
          languages={languages}
          language={language}
          onLanguageChange={setLanguageChoice}
          voiceList={voiceList}
          onVoiceListChange={setVoiceList}
          config={config}
          onConfigChange={setConfig}
          globalSpeed={globalSpeed}
          onGlobalSpeedChange={setGlobalSpeed}
          disabled={generation.isGenerating}
        />

        <QueueTable
          items={items}
          config={config}
          arranged={arrangedVoices}
          voicesByKey={voiceLibrary.voicesByKey}
          globalSpeed={globalSpeed}
          outdatedIds={outdatedIds}
          locked={generation.isGenerating}
          onAddFile={actions.addEmpty}
          onEdit={actions.edit}
          onRemove={actions.remove}
          onDownload={handleDownload}
          playback={playback}
          onPlay={handlePlay}
          onSample={handleSample}
          onStopPlayback={stopPlayback}
        />

        <ProgressPanel stats={stats} />
      </main>

      <Toolbar
        isGenerating={generation.isGenerating}
        canGenerate={items.length > 0}
        onGenerate={() => void handleGenerate()}
        onStop={generation.stop}
        completedCount={stats.completed}
        zipProgress={zipProgress}
        onDownloadAll={() => void handleDownloadAll()}
        canClear={items.length > 0 && !generation.isGenerating}
        onClear={handleClear}
        credits={credits}
      >
        {notice && <Notice {...notice} onDismiss={() => setNotice(null)} />}
      </Toolbar>
    </div>
  );
}
