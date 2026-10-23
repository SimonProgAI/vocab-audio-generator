import { useCallback, useMemo, useState } from "react";
import { BulkImport } from "./components/BulkImport";
import { Notice, type NoticeContent } from "./components/Notice";
import { ProgressPanel } from "./components/ProgressPanel";
import { QueueTable } from "./components/QueueTable";
import { SpeakerSettings } from "./components/SpeakerSettings";
import { Toolbar } from "./components/Toolbar";
import { type GenerationSummary, useGeneration } from "./hooks/useGeneration";
import { useQueue } from "./hooks/useQueue";
import { useVoices } from "./hooks/useVoices";
import { isUpToDate, planGeneration } from "./services/assignment";
import {
  ZIP_FILENAME,
  downloadAllCompleted,
  downloadItem,
  toMp3Name,
  type ZipProgress,
} from "./services/download";
import { getErrorMessage, isApiKeyConfigured } from "./services/ttsApi";
import type { QueueItem, SpeakerConfig } from "./types/queue";
import { pluralize } from "./utils/format";
import { DEFAULT_SPEED } from "./utils/speed";
import { defaultLanguage, matchesLanguage, summarizeLanguages } from "./utils/voices";

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

export default function App() {
  const { items, stats, actions } = useQueue();
  const voiceLibrary = useVoices();
  const generation = useGeneration(actions.applyProgress);

  const [config, setConfig] = useState<SpeakerConfig>({ mode: "single", selectedVoices: [] });
  const [globalSpeed, setGlobalSpeed] = useState(DEFAULT_SPEED);
  const [languageChoice, setLanguageChoice] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeContent | null>(null);
  const [zipProgress, setZipProgress] = useState<ZipProgress | null>(null);

  const languages = useMemo(() => summarizeLanguages(voiceLibrary.voices), [voiceLibrary.voices]);
  const language = languageChoice ?? defaultLanguage(languages);
  const visibleVoices = useMemo(
    () => voiceLibrary.voices.filter((voice) => matchesLanguage(voice, language)),
    [voiceLibrary.voices, language],
  );
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

  const handleDownload = useCallback(async (item: QueueItem) => {
    try {
      await downloadItem(item);
    } catch (error) {
      setNotice({
        tone: "error",
        title: `Couldn't download ${toMp3Name(item.filename)}`,
        messages: [getErrorMessage(error)],
      });
    }
  }, []);

  const handleDownloadAll = async () => {
    try {
      const result = await downloadAllCompleted(items, setZipProgress);
      setNotice(
        result.skipped.length > 0
          ? {
              tone: "warning",
              title: `${ZIP_FILENAME} saved with ${pluralize(result.added, "file")}`,
              messages: [
                `${pluralize(result.skipped.length, "file")} couldn't be downloaded and ${result.skipped.length === 1 ? "was" : "were"} left out: ${result.skipped.join(", ")}`,
              ],
            }
          : null,
      );
    } catch (error) {
      setNotice({ tone: "error", title: "Couldn't create the ZIP file", messages: [getErrorMessage(error)] });
    } finally {
      setZipProgress(null);
    }
  };

  const handleClear = () => {
    if (window.confirm(`Remove all ${pluralize(items.length, "file")} from the queue?`)) {
      actions.clear();
      setNotice(null);
    }
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
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {!isApiKeyConfigured && (
          <Notice
            tone="warning"
            title="No TTS.ai API key configured"
            messages={[
              "Copy .env.example to .env, set VITE_TTS_API_KEY, and restart the dev server. Without a key, TTS.ai only allows limited anonymous use.",
            ]}
          />
        )}

        <BulkImport onAdd={actions.addTexts} />

        <SpeakerSettings
          voiceStatus={voiceLibrary.status}
          voiceError={voiceLibrary.error}
          onRetryVoices={voiceLibrary.reload}
          voices={visibleVoices}
          voicesByKey={voiceLibrary.voicesByKey}
          languages={languages}
          language={language}
          onLanguageChange={setLanguageChoice}
          config={config}
          onConfigChange={setConfig}
          globalSpeed={globalSpeed}
          onGlobalSpeedChange={setGlobalSpeed}
          disabled={generation.isGenerating}
        />

        <QueueTable
          items={items}
          config={config}
          voices={visibleVoices}
          voicesByKey={voiceLibrary.voicesByKey}
          globalSpeed={globalSpeed}
          outdatedIds={outdatedIds}
          locked={generation.isGenerating}
          onAddFile={actions.addEmpty}
          onEdit={actions.edit}
          onRemove={actions.remove}
          onDownload={handleDownload}
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
      >
        {notice && <Notice {...notice} onDismiss={() => setNotice(null)} />}
      </Toolbar>
    </div>
  );
}
