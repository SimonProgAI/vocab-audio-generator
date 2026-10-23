import { memo, useState } from "react";
import type { QueueItem, QueueItemEdit, Voice } from "../types/queue";
import { SPEED_OPTIONS, effectiveSpeed, formatSpeed } from "../utils/speed";
import { Button } from "./Button";
import { FIELD_CLASS } from "./fieldStyles";
import { StatusBadge } from "./StatusBadge";
import { VoiceSelect } from "./VoiceSelect";

interface QueueRowProps {
  item: QueueItem;
  index: number;
  globalSpeed: number;
  /** Per File mode shows a speaker picker; other modes show `assignedSpeaker`. */
  speakerEditable: boolean;
  assignedSpeaker: string;
  voices: Voice[];
  voicesByKey: ReadonlyMap<string, Voice>;
  outdated: boolean;
  locked: boolean;
  onEdit: (id: string, changes: QueueItemEdit) => void;
  onRemove: (id: string) => void;
  onDownload: (item: QueueItem) => Promise<void>;
}

const CELL = "px-3 py-2.5 align-top";

function QueueRowComponent({
  item,
  index,
  globalSpeed,
  speakerEditable,
  assignedSpeaker,
  voices,
  voicesByKey,
  outdated,
  locked,
  onEdit,
  onRemove,
  onDownload,
}: QueueRowProps) {
  const [downloading, setDownloading] = useState(false);
  const row = index + 1;
  const canDownload = item.status === "completed" && Boolean(item.downloadUrl);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await onDownload(item);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50/70">
      <td className={`${CELL} pt-4 text-xs tabular-nums text-slate-400`}>{row}</td>

      <td className={CELL}>
        <input
          type="text"
          value={item.text}
          onChange={(event) => onEdit(item.id, { text: event.target.value })}
          disabled={locked}
          placeholder="Type a word or phrase"
          aria-label={`Speech text, row ${row}`}
          className={FIELD_CLASS}
        />
      </td>

      <td className={CELL}>
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={item.filename}
            onChange={(event) => onEdit(item.id, { filename: event.target.value })}
            readOnly={item.autoFilename}
            disabled={locked}
            placeholder="filename"
            aria-label={`Filename, row ${row}`}
            title={item.autoFilename ? "Untick Auto to edit the filename" : undefined}
            className={`${FIELD_CLASS} font-mono text-xs`}
          />
          <span className="text-xs text-slate-400">.mp3</span>
        </div>
      </td>

      <td className={`${CELL} pt-4 text-center`}>
        <input
          type="checkbox"
          checked={item.autoFilename}
          onChange={(event) => onEdit(item.id, { autoFilename: event.target.checked })}
          disabled={locked}
          aria-label={`Auto filename, row ${row}`}
          className="h-4 w-4 accent-blue-600"
        />
      </td>

      <td className={CELL}>
        <select
          value={String(effectiveSpeed(item, globalSpeed))}
          onChange={(event) => onEdit(item.id, { speed: Number(event.target.value) })}
          disabled={locked || !item.overrideSpeed}
          aria-label={`Speed, row ${row}`}
          className={FIELD_CLASS}
        >
          {SPEED_OPTIONS.map((speed) => (
            <option key={speed} value={String(speed)}>
              {formatSpeed(speed)}
            </option>
          ))}
        </select>
        <label className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={item.overrideSpeed}
            onChange={(event) =>
              onEdit(
                item.id,
                event.target.checked ? { overrideSpeed: true, speed: globalSpeed } : { overrideSpeed: false },
              )
            }
            disabled={locked}
            className="h-3.5 w-3.5 accent-blue-600"
          />
          Custom
        </label>
      </td>

      <td className={CELL}>
        {speakerEditable ? (
          <VoiceSelect
            voices={voices}
            voicesByKey={voicesByKey}
            value={item.speaker}
            onChange={(speaker) => onEdit(item.id, { speaker })}
            placeholder="Choose…"
            disabled={locked || voicesByKey.size === 0}
            ariaLabel={`Speaker, row ${row}`}
          />
        ) : (
          <span className="block truncate pt-1.5 text-sm text-slate-600" title={assignedSpeaker}>
            {assignedSpeaker}
          </span>
        )}
      </td>

      <td className={`${CELL} pt-3`}>
        <StatusBadge status={item.status} />
        {outdated && (
          <p className="mt-1 text-xs text-amber-700">Settings changed — Generate All will redo it.</p>
        )}
        {item.status === "failed" && item.error && (
          <p className="mt-1 line-clamp-3 text-xs text-red-600" title={item.error}>
            {item.error}
          </p>
        )}
      </td>

      <td className={CELL}>
        <div className="flex items-center justify-end gap-1">
          {canDownload && (
            <Button size="sm" onClick={handleDownload} disabled={downloading}>
              {downloading ? "Saving…" : "Download"}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRemove(item.id)}
            disabled={locked}
            aria-label={`Remove row ${row}`}
            title="Remove row"
            className="hover:text-red-700"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
                clipRule="evenodd"
              />
            </svg>
          </Button>
        </div>
      </td>
    </tr>
  );
}

export const QueueRow = memo(QueueRowComponent);
