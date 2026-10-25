import { Fragment } from "react";
import type { Voice } from "../types/queue";
import { arrangeVoices, formatVoiceLabel, type VoiceOrder } from "../utils/voices";
import { FIELD_CLASS } from "./fieldStyles";

interface VoiceSelectProps {
  id?: string;
  voices: Voice[];
  voicesByKey: ReadonlyMap<string, Voice>;
  order: VoiceOrder;
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
  order,
  value,
  onChange,
  placeholder,
  disabled = false,
  ariaLabel,
}: VoiceSelectProps) {
  // Keep the current choice visible even when the language filter hides it.
  const current = value ? voicesByKey.get(value) : undefined;
  const options =
    current && !voices.some((voice) => voice.key === current.key) ? [current, ...voices] : voices;

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
      {arrangeVoices(options, order).map((group) =>
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
