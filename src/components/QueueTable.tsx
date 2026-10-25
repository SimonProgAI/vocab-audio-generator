import type { Playback } from "../hooks/useAudioPlayer";
import { previewSpeaker } from "../services/assignment";
import type { QueueItem, QueueItemEdit, SpeakerConfig, Voice } from "../types/queue";
import { pluralize } from "../utils/format";
import { voiceName, type VoiceOrder } from "../utils/voices";
import { Button } from "./Button";
import { QueueRow } from "./QueueRow";
import { Section } from "./Section";

interface QueueTableProps {
  items: QueueItem[];
  config: SpeakerConfig;
  voices: Voice[];
  voicesByKey: ReadonlyMap<string, Voice>;
  voiceOrder: VoiceOrder;
  globalSpeed: number;
  outdatedIds: ReadonlySet<string>;
  locked: boolean;
  onAddFile: () => void;
  onEdit: (id: string, changes: QueueItemEdit) => void;
  onRemove: (id: string) => void;
  onDownload: (item: QueueItem) => Promise<void>;
  playback: Playback | null;
  onPlay: (item: QueueItem) => void;
  onSample: (item: QueueItem, voice: Voice) => void;
  onStopPlayback: () => void;
}

const COLUMNS: ReadonlyArray<{ label: string; className: string }> = [
  { label: "#", className: "w-10" },
  { label: "Text", className: "" },
  { label: "Filename", className: "w-52" },
  { label: "Auto", className: "w-14 text-center" },
  { label: "Speed", className: "w-28" },
  { label: "Speaker", className: "w-56" },
  { label: "Status", className: "w-40" },
  { label: "Actions", className: "w-48 text-right" },
];

/** Speaker shown for modes other than Per File: the actual one once generation starts, else a preview. */
function assignedSpeakerLabel(
  item: QueueItem,
  index: number,
  config: SpeakerConfig,
  voicesByKey: ReadonlyMap<string, Voice>,
): string {
  const speakerKey = item.status === "pending" ? previewSpeaker(item, index, config) : item.speaker;
  if (speakerKey) return voiceName(speakerKey, voicesByKey);
  return config.mode === "random" ? "Random pick" : "Not chosen yet";
}

/** The voice a row is set to get, so it can be sampled; unknown in random mode. */
function sampleVoiceFor(
  item: QueueItem,
  index: number,
  config: SpeakerConfig,
  voicesByKey: ReadonlyMap<string, Voice>,
): Voice | undefined {
  const speakerKey = previewSpeaker(item, index, config);
  return speakerKey ? voicesByKey.get(speakerKey) : undefined;
}

export function QueueTable({
  items,
  config,
  voices,
  voicesByKey,
  voiceOrder,
  globalSpeed,
  outdatedIds,
  locked,
  onAddFile,
  onEdit,
  onRemove,
  onDownload,
  playback,
  onPlay,
  onSample,
  onStopPlayback,
}: QueueTableProps) {
  return (
    <Section
      step={3}
      title="Queue"
      description="Edit text, filenames, speed, and speakers before generating."
      actions={
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{pluralize(items.length, "file")}</span>
          <Button onClick={onAddFile}>+ Add File</Button>
        </div>
      }
    >
      <div className="max-h-[36rem] overflow-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[1100px] table-fixed text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 shadow-[inset_0_-1px_0_var(--color-slate-200)]">
            <tr>
              {COLUMNS.map((column) => (
                <th key={column.label} scope="col" className={`px-3 py-2.5 ${column.className}`}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-12 text-center text-sm text-slate-500">
                  Your queue is empty. Paste vocabulary above, or click <strong>Add File</strong>.
                </td>
              </tr>
            ) : (
              items.map((item, index) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  index={index}
                  globalSpeed={globalSpeed}
                  speakerEditable={config.mode === "perFile"}
                  assignedSpeaker={assignedSpeakerLabel(item, index, config, voicesByKey)}
                  voices={voices}
                  voicesByKey={voicesByKey}
                  voiceOrder={voiceOrder}
                  outdated={outdatedIds.has(item.id)}
                  locked={locked}
                  onEdit={onEdit}
                  onRemove={onRemove}
                  onDownload={onDownload}
                  sampleVoice={sampleVoiceFor(item, index, config, voicesByKey)}
                  playback={playback?.id === item.id ? playback.state : undefined}
                  onPlay={onPlay}
                  onSample={onSample}
                  onStopPlayback={onStopPlayback}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
