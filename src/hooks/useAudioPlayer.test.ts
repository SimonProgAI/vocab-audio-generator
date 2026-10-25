// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { useAudioPlayer } from "./useAudioPlayer";

const clip = new Blob([new Uint8Array([0xff, 0xfb, 0x90])], { type: "audio/mpeg" });

let play: MockInstance<HTMLMediaElement["play"]>;
let pause: MockInstance<HTMLMediaElement["pause"]>;

beforeEach(() => {
  // jsdom can't play audio or make object URLs.
  let urls = 0;
  URL.createObjectURL = vi.fn(() => `blob:clip-${(urls += 1)}`);
  URL.revokeObjectURL = vi.fn();
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A load the test finishes by hand. */
function deferredLoad() {
  let finish!: (blob: Blob) => void;
  const load = vi.fn(() => new Promise<Blob>((resolve) => (finish = resolve)));
  return { load, finish: (blob = clip) => finish(blob) };
}

/** The audio element play() was called on, in call order. */
const playedElement = (call = 0) => play.mock.contexts[call] as HTMLAudioElement;

describe("useAudioPlayer", () => {
  it("shows loading, then plays the clip from an object URL", async () => {
    const { result } = renderHook(() => useAudioPlayer());
    const { load, finish } = deferredLoad();

    let started!: Promise<void>;
    act(() => {
      started = result.current.play("row-1", load);
    });
    expect(result.current.current).toEqual({ id: "row-1", state: "loading" });

    await act(async () => {
      finish();
      await started;
    });
    expect(result.current.current).toEqual({ id: "row-1", state: "playing" });
    expect(URL.createObjectURL).toHaveBeenCalledWith(clip);
    expect(playedElement().src).toBe("blob:clip-1");
  });

  it("clears and frees the object URL when the clip ends", async () => {
    const { result } = renderHook(() => useAudioPlayer());
    await act(() => result.current.play("row-1", async () => clip));

    act(() => {
      playedElement().dispatchEvent(new Event("ended"));
    });

    expect(result.current.current).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:clip-1");
  });

  it("stops the playing clip when another one starts", async () => {
    const { result } = renderHook(() => useAudioPlayer());
    await act(() => result.current.play("row-1", async () => clip));
    await act(() => result.current.play("row-2", async () => clip));

    expect(pause.mock.contexts).toContain(playedElement(0));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:clip-1");
    expect(result.current.current).toEqual({ id: "row-2", state: "playing" });
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("never plays a clip that was stopped while loading", async () => {
    const { result } = renderHook(() => useAudioPlayer());
    const { load, finish } = deferredLoad();
    let started!: Promise<void>;
    act(() => {
      started = result.current.play("row-1", load);
    });

    act(() => result.current.stop());
    await act(async () => {
      finish();
      await started;
    });

    expect(play).not.toHaveBeenCalled();
    expect(result.current.current).toBeNull();
  });

  it("never plays a clip that was replaced while loading", async () => {
    const { result } = renderHook(() => useAudioPlayer());
    const slow = deferredLoad();
    let first!: Promise<void>;
    act(() => {
      first = result.current.play("row-1", slow.load);
    });
    await act(() => result.current.play("row-2", async () => clip));
    await act(async () => {
      slow.finish();
      await first;
    });

    expect(play).toHaveBeenCalledTimes(1);
    expect(result.current.current).toEqual({ id: "row-2", state: "playing" });
  });

  it("rejects and resets when the clip can't be loaded", async () => {
    const { result } = renderHook(() => useAudioPlayer());
    const failure = new Error("Couldn't reach TTS.ai.");
    await act(async () => {
      await expect(result.current.play("row-1", () => Promise.reject(failure))).rejects.toBe(failure);
    });
    expect(result.current.current).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });

  it("explains when the browser blocks playback", async () => {
    play.mockRejectedValueOnce(new DOMException("Not allowed", "NotAllowedError"));
    const { result } = renderHook(() => useAudioPlayer());
    await act(async () => {
      await expect(result.current.play("row-1", async () => clip)).rejects.toThrow(
        "Your browser blocked playback. Click again to play it.",
      );
    });
    expect(result.current.current).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:clip-1");
  });

  it("stops playing when the page goes away", async () => {
    const { result, unmount } = renderHook(() => useAudioPlayer());
    await act(() => result.current.play("row-1", async () => clip));
    unmount();
    expect(pause.mock.contexts).toContain(playedElement());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:clip-1");
  });
});
