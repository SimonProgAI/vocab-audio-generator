import { describe, expect, it } from "vitest";
import type { QueueItem } from "../types/queue";
import { computeStats, queueReducer } from "./useQueue";

function add(...texts: string[]): QueueItem[] {
  return queueReducer([], { type: "add", texts });
}

function first(items: QueueItem[]): QueueItem {
  const [item] = items;
  if (!item) throw new Error("Expected at least one queue item.");
  return item;
}

const completed: Partial<QueueItem> = {
  status: "completed",
  jobId: "job-1",
  downloadUrl: "https://api.tts.ai/files/bonjour.mp3",
  generatedWith: { speaker: "melotts:FR", speed: 1 },
};

describe("queueReducer", () => {
  it("adds pending rows with an automatic filename", () => {
    const items = add("une rivière", "ça va");
    expect(items).toMatchObject([
      { text: "une rivière", filename: "une_riviere", autoFilename: true, speed: 1, overrideSpeed: false, status: "pending" },
      { text: "ça va", filename: "ca_va", status: "pending" },
    ]);
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
  });

  it("appends to the existing rows", () => {
    const items = queueReducer(add("un"), { type: "add", texts: ["deux"] });
    expect(items.map((item) => item.text)).toEqual(["un", "deux"]);
  });

  it("resets generated audio when the text changes", () => {
    const row = { ...first(add("bonjour")), ...completed };
    const edited = first(queueReducer([row], { type: "edit", id: row.id, changes: { text: "bonsoir" } }));
    expect(edited).toMatchObject({ text: "bonsoir", filename: "bonsoir", status: "pending" });
    expect(edited.jobId).toBeUndefined();
    expect(edited.downloadUrl).toBeUndefined();
    expect(edited.generatedWith).toBeUndefined();
  });

  it("keeps generated audio when the text is unchanged or another field changes", () => {
    const row = { ...first(add("bonjour")), ...completed };
    const sameText = first(queueReducer([row], { type: "edit", id: row.id, changes: { text: "bonjour" } }));
    const newSpeed = first(queueReducer([row], { type: "edit", id: row.id, changes: { overrideSpeed: true, speed: 1.5 } }));
    expect(sameText).toMatchObject(completed);
    expect(newSpeed).toMatchObject(completed);
  });

  it("sanitizes manual filenames and stops following the text", () => {
    const row = first(add("bonjour"));
    const renamed = queueReducer([row], {
      type: "edit",
      id: row.id,
      changes: { autoFilename: false, filename: "mon:fichier?" },
    });
    expect(first(renamed).filename).toBe("monfichier");
    const retexted = queueReducer(renamed, { type: "edit", id: row.id, changes: { text: "salut" } });
    expect(first(retexted).filename).toBe("monfichier");
  });

  it("goes back to the automatic filename when Auto is ticked again", () => {
    const row = { ...first(add("bonjour")), autoFilename: false, filename: "custom" };
    const edited = queueReducer([row], { type: "edit", id: row.id, changes: { autoFilename: true } });
    expect(first(edited).filename).toBe("bonjour");
  });

  it("removes one row, or clears them all", () => {
    const items = add("un", "deux");
    expect(queueReducer(items, { type: "remove", id: first(items).id }).map((item) => item.text)).toEqual(["deux"]);
    expect(queueReducer(items, { type: "clear" })).toEqual([]);
  });

  it("applies progress updates only to the matching rows", () => {
    const [one, two] = add("un", "deux");
    if (!one || !two) throw new Error("Expected two queue items.");
    const items = queueReducer([one, two], {
      type: "progress",
      updates: [{ id: two.id, changes: { status: "processing", jobId: "job-2" } }],
    });
    expect(items).toEqual([one, { ...two, status: "processing", jobId: "job-2" }]);
  });
});

describe("computeStats", () => {
  it("counts rows by status", () => {
    const [a, b, c] = add("a", "b", "c");
    if (!a || !b || !c) throw new Error("Expected three queue items.");
    const items: QueueItem[] = [a, { ...b, status: "completed" }, { ...c, status: "failed" }];
    expect(computeStats(items)).toEqual({ total: 3, pending: 1, queued: 0, processing: 0, completed: 1, failed: 1 });
  });
});
