// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { QueueItem } from "../types/queue";
import { computeStats, queueReducer, useQueue } from "./useQueue";

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

describe("queueReducer expire", () => {
  const url = "https://cdn.tts.ai/job-1/tts_output.mp3";
  const done = (overrides: Partial<QueueItem> = {}): QueueItem => ({ ...first(add("bonjour")), ...completed, downloadUrl: url, ...overrides });

  it("fails a row whose link expired and forgets the link", () => {
    const row = done();
    const [expired] = queueReducer([row], { type: "expire", id: row.id, url, error: "Expired." });
    expect(expired).toMatchObject({ status: "failed", error: "Expired." });
    expect(expired?.downloadUrl).toBeUndefined();
    expect(expired?.generatedWith).toBeUndefined();
    expect(expired?.jobId).toBeUndefined();
  });

  it("leaves a row alone when it has a different link by now, e.g. after regenerating", () => {
    const row = done({ downloadUrl: "https://cdn.tts.ai/job-2/tts_output.mp3" });
    expect(queueReducer([row], { type: "expire", id: row.id, url, error: "Expired." })).toEqual([row]);
  });

  it("leaves a row alone while it is being regenerated", () => {
    const row = done({ status: "queued", downloadUrl: undefined, jobId: "job-2" });
    expect(queueReducer([row], { type: "expire", id: row.id, url, error: "Expired." })).toEqual([row]);
  });

  it("only touches the given row", () => {
    const row = done();
    const other = { ...done(), id: "other" };
    expect(queueReducer([row, other], { type: "expire", id: row.id, url, error: "Expired." })[1]).toBe(other);
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

describe("useQueue", () => {
  afterEach(cleanup);

  it("starts empty by default", () => {
    const { result } = renderHook(() => useQueue());
    expect(result.current.items).toEqual([]);
    expect(result.current.stats.total).toBe(0);
  });

  it("starts from the given rows, such as ones restored after a reload", () => {
    const restored = add("un", "deux");
    const { result } = renderHook(() => useQueue(restored));
    expect(result.current.items).toEqual(restored);
    expect(result.current.stats).toMatchObject({ total: 2, pending: 2 });
  });

  it("only uses the initial rows on the first render", () => {
    const { result, rerender } = renderHook(({ initial }) => useQueue(initial), {
      initialProps: { initial: add("un") },
    });
    rerender({ initial: add("deux", "trois") });
    expect(result.current.items.map((item) => item.text)).toEqual(["un"]);
  });
});
