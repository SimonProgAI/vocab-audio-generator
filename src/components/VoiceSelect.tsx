import { Fragment } from "react";
import type { Voice } from "../types/queue";
import { formatVoiceLabel, type ArrangedVoices } from "../utils/voices";
import { FIELD_CLASS } from "./fieldStyles";

interface VoiceSelectProps {
  id?: string;
  /** The speaker list, already filtered and sorted (see arrangeVoiceList). */
  arranged: ArrangedVoices;
  voicesByKey: ReadonlyMap<string, Voice>;
  value: string | undefined;
  onChange: (voiceKey: string) => void;
  placeholder: string;
  disabled?: boolean;
  ariaLabel?: string;
}

/** Value of the line explaining an empty list; never a voice key, and never "" (the placeholder's). */
const EMPTY_NOTE = "__no-voices__";

function renderOption(voice: Voice) {
  return (
    <option key={voice.key} value={voice.key}>
      {formatVoiceLabel(voice)}
    </option>
  );
}

export function VoiceSelect({
  id,
  arranged,
  voicesByKey,
  value,
  onChange,
  placeholder,
  disabled = false,
  ariaLabel,
}: VoiceSelectProps) {
  const current = value ? voicesByKey.get(value) : undefined;
  // Keep the current choice visible, first, even when the language or the checkboxes hide it.
  const hiddenCurrent = current && !arranged.shown.has(current.key) ? current : undefined;

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
      {arranged.emptyMessage && (
        <option value={EMPTY_NOTE} disabled>
          {arranged.emptyMessage}
        </option>
      )}
      {arranged.groups.map((group) =>
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
