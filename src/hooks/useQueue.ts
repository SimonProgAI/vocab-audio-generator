import { useMemo, useReducer } from "react";
import { v4 as uuidv4 } from "uuid";
import type {
  QueueItem,
  QueueItemEdit,
  QueueItemProgress,
  QueueItemUpdate,
  QueueStats,
} from "../types/queue";
import { sanitizeFilename, slugify } from "../utils/slugify";
import { DEFAULT_SPEED } from "../utils/speed";

type QueueAction =
  | { type: "add"; texts: string[] }
  | { type: "edit"; id: string; changes: QueueItemEdit }
  | { type: "remove"; id: string }
  | { type: "clear" }
  | { type: "progress"; updates: QueueItemUpdate[] }
  | { type: "expire"; id: string; url: string; error: string };

const RESET_GENERATION: QueueItemProgress = {
  status: "pending",
  jobId: undefined,
  downloadUrl: undefined,
  error: undefined,
  generatedWith: undefined,
};

function createItem(text: string): QueueItem {
  return {
    id: uuidv4(),
    text,
    filename: slugify(text),
    autoFilename: true,
    speed: DEFAULT_SPEED,
    overrideSpeed: false,
    status: "pending",
  };
}

function applyEdit(item: QueueItem, changes: QueueItemEdit): QueueItem {
  const next: QueueItem = { ...item, ...changes };
  if (changes.filename !== undefined) next.filename = sanitizeFilename(changes.filename);
  if (next.autoFilename) next.filename = slugify(next.text);
  // New text means the existing audio says the wrong thing, so it can't be kept.
  // Speaker and speed changes are detected later by isUpToDate().
  const textChanged = changes.text !== undefined && changes.text !== item.text;
  return textChanged ? { ...next, ...RESET_GENERATION } : next;
}

export function queueReducer(state: QueueItem[], action: QueueAction): QueueItem[] {
  switch (action.type) {
    case "add":
      return [...state, ...action.texts.map(createItem)];
    case "edit":
      return state.map((item) => (item.id === action.id ? applyEdit(item, action.changes) : item));
    case "remove":
      return state.filter((item) => item.id !== action.id);
    case "clear":
      return [];
    case "progress": {
      const updates = new Map(action.updates.map(({ id, changes }) => [id, changes]));
      return state.map((item) => {
        const changes = updates.get(item.id);
        return changes ? { ...item, ...changes } : item;
      });
    }
    case "expire":
      // Only while the row still has the link that failed: it may have been regenerated meanwhile.
      return state.map((item) =>
        item.id === action.id && item.downloadUrl === action.url
          ? { ...item, ...RESET_GENERATION, status: "failed", error: action.error }
          : item,
      );
  }
}

export function computeStats(items: QueueItem[]): QueueStats {
  const stats: QueueStats = {
    total: items.length,
    pending: 0,
    queued: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  };
  for (const item of items) stats[item.status] += 1;
  return stats;
}

export interface QueueActions {
  addTexts: (texts: string[]) => void;
  addEmpty: () => void;
  edit: (id: string, changes: QueueItemEdit) => void;
  remove: (id: string) => void;
  clear: () => void;
  applyProgress: (updates: QueueItemUpdate[]) => void;
  /** Fails a row whose audio link no longer works, unless the row has a different link by now. */
  expire: (id: string, url: string, error: string) => void;
}

/** `initialItems` seeds the queue on first render, e.g. rows restored after a reload. */
export function useQueue(initialItems: readonly QueueItem[] = []) {
  const [items, dispatch] = useReducer(queueReducer, initialItems, (initial) => [...initial]);
  const stats = useMemo(() => computeStats(items), [items]);
  const actions = useMemo<QueueActions>(
    () => ({
      addTexts: (texts) => dispatch({ type: "add", texts }),
      addEmpty: () => dispatch({ type: "add", texts: [""] }),
      edit: (id, changes) => dispatch({ type: "edit", id, changes }),
      remove: (id) => dispatch({ type: "remove", id }),
      clear: () => dispatch({ type: "clear" }),
      applyProgress: (updates) => dispatch({ type: "progress", updates }),
      expire: (id, url, error) => dispatch({ type: "expire", id, url, error }),
    }),
    [],
  );
  return { items, stats, actions };
}
