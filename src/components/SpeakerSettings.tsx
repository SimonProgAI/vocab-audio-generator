import { memo, useId } from "react";
import type { VoiceLoadStatus } from "../hooks/useVoices";
import type { AssignmentMode, SpeakerConfig, Voice } from "../types/queue";
import { pluralize } from "../utils/format";
import {
  DEFAULT_SPEED,
  MAX_SPEED,
  MIN_SPEED,
  SPEED_STEP,
  formatSpeed,
  roundSpeed,
} from "../utils/speed";
import {
  ALL_LANGUAGES,
  arrangeVoices,
  formatVoiceLabel,
  voiceName,
  type LanguageSummary,
  isVoiceOrder,
  VOICE_ORDERS,
  type VoiceOrder,
} from "../utils/voices";
import { Button } from "./Button";
import { FIELD_CLASS } from "./fieldStyles";
import { Notice } from "./Notice";
import { Section } from "./Section";
import { Spinner } from "./Spinner";
import { VoiceSelect } from "./VoiceSelect";

interface SpeakerSettingsProps {
  voiceStatus: VoiceLoadStatus;
  voiceError?: string;
  onRetryVoices: () => void;
  /** Voices matching the language filter. */
  voices: Voice[];
  voicesByKey: ReadonlyMap<string, Voice>;
  languages: LanguageSummary[];
  language: string;
  onLanguageChange: (language: string) => void;
  voiceOrder: VoiceOrder;
  onVoiceOrderChange: (order: VoiceOrder) => void;
  config: SpeakerConfig;
  onConfigChange: (config: SpeakerConfig) => void;
  globalSpeed: number;
  onGlobalSpeedChange: (speed: number) => void;
  disabled: boolean;
}

const MODES: ReadonlyArray<{ value: AssignmentMode; label: string; description: string }> = [
  { value: "single", label: "Single Speaker", description: "Every file uses the same voice." },
  { value: "perFile", label: "Per File", description: "Pick a voice in each row of the queue." },
  { value: "random", label: "Random Assignment", description: "Each file gets a random voice from your pool." },
  { value: "roundRobin", label: "Round Robin", description: "Voices take turns in the order you set." },
];

function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}

function SpeakerSettingsComponent({
  voiceStatus,
  voiceError,
  onRetryVoices,
  voices,
  voicesByKey,
  languages,
  language,
  onLanguageChange,
  voiceOrder,
  onVoiceOrderChange,
  config,
  onConfigChange,
  globalSpeed,
  onGlobalSpeedChange,
  disabled,
}: SpeakerSettingsProps) {
  const modeName = useId();
  const singleSpeakerId = useId();
  const languageId = useId();
  const orderId = useId();
  const speedId = useId();
  const pickersDisabled = disabled || voiceStatus !== "ready";

  const update = (changes: Partial<SpeakerConfig>) => onConfigChange({ ...config, ...changes });

  const toggleVoice = (voiceKey: string) =>
    update({
      selectedVoices: config.selectedVoices.includes(voiceKey)
        ? config.selectedVoices.filter((key) => key !== voiceKey)
        : [...config.selectedVoices, voiceKey],
    });

  // In the order the list shows them, so a round robin follows what's on screen.
  const selectAllShown = () =>
    update({
      selectedVoices: [
        ...config.selectedVoices,
        ...arrangeVoices(voices, voiceOrder)
          .flatMap((group) => group.voices.map((voice) => voice.key))
          .filter((key) => !config.selectedVoices.includes(key)),
      ],
    });

  const moveVoice = (index: number, offset: -1 | 1) =>
    update({ selectedVoices: moveItem(config.selectedVoices, index, index + offset) });

  const checklist = (
    <VoiceChecklist
      voices={voices}
      order={voiceOrder}
      selected={config.selectedVoices}
      onToggle={toggleVoice}
      onSelectAll={selectAllShown}
      onClear={() => update({ selectedVoices: [] })}
      disabled={pickersDisabled}
    />
  );

  return (
    <Section
      step={2}
      title="Speaker Settings"
      description="Choose how voices are assigned to files and how fast they speak."
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <fieldset disabled={disabled}>
            <legend className="text-sm font-medium text-slate-700">Assignment mode</legend>
            <div className="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-4">
              {MODES.map((mode) => {
                const checked = config.mode === mode.value;
                return (
                  <label
                    key={mode.value}
                    className={`cursor-pointer rounded-lg border p-3 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-600 ${
                      checked
                        ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500"
                        : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    <input
                      type="radio"
                      name={modeName}
                      value={mode.value}
                      checked={checked}
                      onChange={() => update({ mode: mode.value })}
                      className="sr-only"
                    />
                    <span className="block font-medium text-slate-900">{mode.label}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{mode.description}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            {config.mode === "single" && (
              <div className="max-w-md">
                <label htmlFor={singleSpeakerId} className="mb-1 block text-sm font-medium text-slate-700">
                  Speaker for every file
                </label>
                <VoiceSelect
                  id={singleSpeakerId}
                  voices={voices}
                  voicesByKey={voicesByKey}
                  order={voiceOrder}
                  value={config.singleSpeaker}
                  onChange={(id) => update({ singleSpeaker: id })}
                  placeholder="Choose a speaker…"
                  disabled={pickersDisabled}
                />
              </div>
            )}
            {config.mode === "perFile" && (
              <p className="text-sm text-slate-600">
                Choose a speaker in the <strong>Speaker</strong> column of each row in the queue below.
              </p>
            )}
            {config.mode === "random" && checklist}
            {config.mode === "roundRobin" && (
              <div className="grid gap-4 md:grid-cols-2">
                {checklist}
                <SpeakerOrder
                  selected={config.selectedVoices}
                  voicesByKey={voicesByKey}
                  onMove={moveVoice}
                  disabled={disabled}
                />
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <label htmlFor={languageId} className="mb-1 block text-sm font-medium text-slate-700">
              Voice language
            </label>
            <select
              id={languageId}
              value={language}
              onChange={(event) => onLanguageChange(event.target.value)}
              disabled={pickersDisabled}
              className={FIELD_CLASS}
            >
              <option value={ALL_LANGUAGES}>All languages ({voicesByKey.size})</option>
              {languages.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.label} ({entry.count})
                </option>
              ))}
            </select>
            <div className="mt-2 text-xs text-slate-500">
              {voiceStatus === "loading" && (
                <span className="inline-flex items-center gap-2">
                  <Spinner className="h-3.5 w-3.5" /> Loading voices from TTS.ai…
                </span>
              )}
              {voiceStatus === "ready" &&
                `${pluralize(voicesByKey.size, "voice")} loaded. The filter applies to every speaker list.`}
            </div>
            {voiceStatus === "error" && (
              <div className="mt-2">
                <Notice
                  tone="error"
                  messages={[voiceError ?? "Couldn't load voices."]}
                  action={
                    <Button size="sm" onClick={onRetryVoices}>
                      Retry
                    </Button>
                  }
                />
              </div>
            )}
          </div>

          <div>
            <label htmlFor={orderId} className="mb-1 block text-sm font-medium text-slate-700">
              Sort voices
            </label>
            <select
              id={orderId}
              value={voiceOrder}
              onChange={(event) => {
                if (isVoiceOrder(event.target.value)) onVoiceOrderChange(event.target.value);
              }}
              disabled={pickersDisabled}
              className={FIELD_CLASS}
            >
              {VOICE_ORDERS.map((order) => (
                <option key={order.value} value={order.value}>
                  {order.label}
                </option>
              ))}
            </select>
            {voiceOrder === "tier" && (
              <p className="mt-2 text-xs text-slate-500">
                Prices come from TTS.ai's docs and a benchmark of the French voices. Other models are
                listed under “Price not known yet”.
              </p>
            )}
            {voiceOrder === "followsSpeed" && (
              <p className="mt-2 text-xs text-slate-500">
                Only voices a check found to follow the speed setting are listed, cheapest first. For
                French, that's kokoro, melotts and piper; other languages haven't been checked yet.
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor={speedId} className="text-sm font-medium text-slate-700">
                Global speed
              </label>
              <span className="text-sm font-semibold tabular-nums text-blue-700">
                {formatSpeed(globalSpeed)}
              </span>
            </div>
            <input
              id={speedId}
              type="range"
              min={MIN_SPEED}
              max={MAX_SPEED}
              step={SPEED_STEP}
              value={globalSpeed}
              onChange={(event) => onGlobalSpeedChange(roundSpeed(Number(event.target.value)))}
              disabled={disabled}
              className="mt-2 w-full accent-blue-600 disabled:opacity-50"
            />
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{formatSpeed(MIN_SPEED)} slower</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onGlobalSpeedChange(DEFAULT_SPEED)}
                disabled={disabled || globalSpeed === DEFAULT_SPEED}
              >
                Reset to {formatSpeed(DEFAULT_SPEED)}
              </Button>
              <span>{formatSpeed(MAX_SPEED)} faster</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Used by every file unless its row has a custom speed. Slower speeds help beginners.
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}

// Memoized so typing in Bulk Import, which re-renders App, doesn't re-render every voice list.
export const SpeakerSettings = memo(SpeakerSettingsComponent);

interface VoiceChecklistProps {
  voices: Voice[];
  order: VoiceOrder;
  selected: string[];
  onToggle: (voiceKey: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  disabled: boolean;
}

function VoiceChecklist({ voices, order, selected, onToggle, onSelectAll, onClear, disabled }: VoiceChecklistProps) {
  const selectedKeys = new Set(selected);
  const groups = arrangeVoices(voices, order);
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">
          Voice pool <span className="font-normal text-slate-500">({selected.length} selected)</span>
        </span>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={onSelectAll} disabled={disabled || groups.length === 0}>
            Select all shown
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear} disabled={disabled || selected.length === 0}>
            Clear
          </Button>
        </div>
      </div>
      {groups.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          {voices.length === 0 ? "No voices to show yet." : "None of these voices is known to follow the speed setting."}
        </p>
      ) : (
        <div className="mt-2 max-h-60 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5">
          {groups.map((group) => (
            <div key={group.key}>
              {group.label && <p className="px-2 pt-1 text-xs font-semibold text-slate-500">{group.label}</p>}
              <ul aria-label={group.label} className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                {group.voices.map((voice) => (
                  <li key={voice.key}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={selectedKeys.has(voice.key)}
                        onChange={() => onToggle(voice.key)}
                        disabled={disabled}
                        className="h-4 w-4 accent-blue-600"
                      />
                      <span className="truncate">{formatVoiceLabel(voice)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface SpeakerOrderProps {
  selected: string[];
  voicesByKey: ReadonlyMap<string, Voice>;
  onMove: (index: number, offset: -1 | 1) => void;
  disabled: boolean;
}

function SpeakerOrder({ selected, voicesByKey, onMove, disabled }: SpeakerOrderProps) {
  return (
    <div>
      <span className="text-sm font-medium text-slate-700">Speaking order</span>
      {selected.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          Tick voices to build the rotation.
        </p>
      ) : (
        <ol className="mt-2 max-h-60 space-y-1 overflow-y-auto">
          {selected.map((id, index) => {
            const name = voiceName(id, voicesByKey);
            return (
              <li
                key={id}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm"
              >
                <span className="w-5 text-xs font-semibold tabular-nums text-slate-400">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onMove(index, -1)}
                  disabled={disabled || index === 0}
                  aria-label={`Move ${name} up`}
                >
                  Move Up
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onMove(index, 1)}
                  disabled={disabled || index === selected.length - 1}
                  aria-label={`Move ${name} down`}
                >
                  Move Down
                </Button>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-2 text-xs text-slate-500">
        File 1 gets speaker 1, file 2 gets speaker 2, and so on, starting over after the last speaker.
      </p>
    </div>
  );
}
