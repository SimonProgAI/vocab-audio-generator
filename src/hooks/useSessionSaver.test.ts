// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveSession, type SessionSnapshot } from "../services/session";
import { SAVE_DELAY_MS, useSessionSaver } from "./useSessionSaver";

vi.mock("../services/session", () => ({ saveSession: vi.fn() }));

function snapshot(draft: string): SessionSnapshot {
  return {
    items: [],
    draft,
    settings: { config: { mode: "single", selectedVoices: [] }, globalSpeed: 1, languageChoice: null, voiceOrder: "name" },
    credits: { used: 0 },
  };
}

function renderSaver(draft: string) {
  return renderHook(({ value }) => useSessionSaver(value), { initialProps: { value: snapshot(draft) } });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(saveSession).mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useSessionSaver", () => {
  it("saves once, a moment after the changes stop", () => {
    const { rerender } = renderSaver("u");
    rerender({ value: snapshot("un") });
    rerender({ value: snapshot("une") });

    vi.advanceTimersByTime(SAVE_DELAY_MS - 1);
    expect(saveSession).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(saveSession).toHaveBeenCalledExactlyOnceWith(snapshot("une"));
  });

  it("saves right away when the page is hidden or reloaded", () => {
    const { rerender } = renderSaver("u");
    rerender({ value: snapshot("une ferme") });

    window.dispatchEvent(new Event("pagehide"));

    expect(saveSession).toHaveBeenCalledExactlyOnceWith(snapshot("une ferme"));
    vi.advanceTimersByTime(SAVE_DELAY_MS);
    expect(saveSession).toHaveBeenCalledTimes(2);
  });

  it("saves what's left when the app goes away", () => {
    const { rerender, unmount } = renderSaver("u");
    rerender({ value: snapshot("une ferme") });
    unmount();
    expect(saveSession).toHaveBeenCalledExactlyOnceWith(snapshot("une ferme"));
    vi.advanceTimersByTime(SAVE_DELAY_MS);
    expect(saveSession).toHaveBeenCalledTimes(1);
  });

  it("doesn't save again when nothing changed since the last save", () => {
    const { unmount } = renderSaver("une ferme");
    vi.advanceTimersByTime(SAVE_DELAY_MS);
    window.dispatchEvent(new Event("pagehide"));
    unmount();
    expect(saveSession).toHaveBeenCalledTimes(1);
  });
});
