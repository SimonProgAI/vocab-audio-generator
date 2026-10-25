import { useId, useMemo, type KeyboardEvent } from "react";
import { pluralize } from "../utils/format";
import { Button } from "./Button";
import { FIELD_CLASS } from "./fieldStyles";
import { Section } from "./Section";

interface BulkImportProps {
  /** The box's text, kept by the parent so it survives a reload. */
  draft: string;
  onDraftChange: (draft: string) => void;
  onAdd: (texts: string[]) => void;
}

const PLACEHOLDER = ["une ferme", "un champ", "un village", "une rivière"].join("\n");

/**
 * One entry per non-blank line. When a list is pasted from a spreadsheet,
 * only the first column is kept.
 */
function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => (line.split("\t")[0] ?? "").trim())
    .filter((line) => line.length > 0);
}

export function BulkImport({ draft, onDraftChange, onAdd }: BulkImportProps) {
  const textareaId = useId();
  const lines = useMemo(() => parseLines(draft), [draft]);

  const handleAdd = () => {
    if (lines.length === 0) return;
    onAdd(lines);
    onDraftChange("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      handleAdd();
    }
  };

  return (
    <Section
      step={1}
      title="Bulk Import"
      description="Paste one word or phrase per line. Blank lines are skipped."
    >
      <label htmlFor={textareaId} className="sr-only">
        Vocabulary list
      </label>
      <textarea
        id={textareaId}
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={PLACEHOLDER}
        rows={6}
        spellCheck={false}
        className={`${FIELD_CLASS} resize-y leading-relaxed`}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {lines.length > 0
            ? `${pluralize(lines.length, "line")} ready to add.`
            : "Tip: press Ctrl+Enter to add the list."}
        </p>
        <Button variant="primary" onClick={handleAdd} disabled={lines.length === 0}>
          Add To Queue
        </Button>
      </div>
    </Section>
  );
}
