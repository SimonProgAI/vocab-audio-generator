import { Fragment } from "react";
import type { Voice } from "../types/queue";
import { arrangeVoices, emptyListMessage, formatVoiceLabel, type VoiceListOptions } from "../utils/voices";
import { FIELD_CLASS } from "./fieldStyles";

interface VoiceSelectProps {
  id?: string;
  voices: Voice[];
  voicesByKey: ReadonlyMap<string, Voice>;
  voiceList: VoiceListOptions;
  value: string | undefined;
  onChange: (voiceKey: string) => void;
  placeholder: string;
  disabled?: boolean;
  ariaLabel?: string;
}

function renderOption(voice: Voice) {
  return (
    <option key={voice.key} value={voice.key}>
      {formatVoiceLabel(voice)}
    </option>
  );
}

export function VoiceSelect({
  id,
  voices,
  voicesByKey,
  voiceList,
  value,
  onChange,
  placeholder,
  disabled = false,
  ariaLabel,
}: VoiceSelectProps) {
  const current = value ? voicesByKey.get(value) : undefined;
  const groups = arrangeVoices(voices, voiceList);
  // Keep the current choice visible, first, even when the language or the checkboxes hide it.
  const shownKeys = new Set(groups.flatMap((group) => group.voices.map((voice) => voice.key)));
  const hiddenCurrent = current && !shownKeys.has(current.key) ? current : undefined;

  return (
    <select
      id={id}
      value={current ? current.key : ""}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
      className={FIELD_CLASS}
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {hiddenCurrent && renderOption(hiddenCurrent)}
      {groups.length === 0 && !hiddenCurrent && voices.length > 0 && (
        <option value="" disabled>
          {emptyListMessage(voiceList)}
        </option>
      )}
      {groups.map((group) =>
        group.label ? (
          <optgroup key={group.key} label={group.label}>
            {group.voices.map(renderOption)}
          </optgroup>
        ) : (
          <Fragment key={group.key}>{group.voices.map(renderOption)}</Fragment>
        ),
      )}
    </select>
  );
}
