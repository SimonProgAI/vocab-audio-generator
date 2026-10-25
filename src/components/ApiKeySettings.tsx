import { useId, useState, type FormEvent } from "react";
import type { SavedApiKey } from "../services/apiKey";
import { Button } from "./Button";
import { FIELD_CLASS } from "./fieldStyles";

interface ApiKeySettingsProps {
  saved: SavedApiKey | undefined;
  /** A key compiled in with VITE_TTS_API_KEY, used when none was entered (local development). */
  hasBuiltInKey: boolean;
  onSave: (key: string, remember: boolean) => void;
  onForget: () => void;
}

const CARD_CLASS = "rounded-xl border border-slate-200 bg-white px-6 py-4 shadow-sm";

export function ApiKeySettings({ saved, hasBuiltInKey, onSave, onForget }: ApiKeySettingsProps) {
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [remember, setRemember] = useState(saved?.remembered ?? false);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    onSave(draft.trim(), remember);
    setDraft("");
    setEditing(false);
  };

  const startEditing = () => {
    setRemember(saved?.remembered ?? false);
    setEditing(true);
  };

  // With no key at all (e.g. after Forget), there is nothing to show but the form.
  if (!editing && (saved || hasBuiltInKey)) {
    return (
      <section className={`${CARD_CLASS} flex flex-wrap items-center justify-between gap-3`}>
        <p className="text-sm text-slate-600">
          {saved ? (
            <>
              <span className="font-medium text-slate-900">TTS.ai API key</span>{" "}
              <span className="font-mono">••••{saved.key.slice(-4)}</span>{" "}
              {saved.remembered ? "· remembered on this device" : "· kept until you close this tab"}
            </>
          ) : (
            <>
              <span className="font-medium text-slate-900">TTS.ai API key</span> from <code>.env</code>{" "}
              (VITE_TTS_API_KEY)
            </>
          )}
        </p>
        <div className="flex gap-1">
          <Button size="sm" onClick={startEditing}>
            {saved ? "Change" : "Use my own key"}
          </Button>
          {saved && (
            <Button size="sm" variant="ghost" onClick={onForget} className="hover:text-red-700">
              Forget
            </Button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className={CARD_CLASS}>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-slate-700">
            TTS.ai API key
          </label>
          <input
            id={inputId}
            type="password"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your key"
            className={`${FIELD_CLASS} font-mono`}
          />
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
            className="h-4 w-4 accent-blue-600"
          />
          Remember on this device
        </label>
        <div className="flex gap-1 pb-0.5">
          <Button type="submit" variant="primary" disabled={!draft.trim()}>
            Save key
          </Button>
          {(saved || hasBuiltInKey) && (
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      </form>
      <p className={`mt-2 text-xs ${saved || hasBuiltInKey ? "text-slate-500" : "text-amber-700"}`}>
        Create a key in your TTS.ai account settings. It stays in this browser and is only sent to
        TTS.ai. Without one, TTS.ai only allows limited anonymous use of its free voices.
      </p>
    </section>
  );
}
