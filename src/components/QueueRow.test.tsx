// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_TEXT } from "../services/voiceSample";
import type { QueueItem, QueueStatus, Voice } from "../types/queue";
import { arrangeVoiceList } from "../utils/voices";
import { QueueRow } from "./QueueRow";

type OnDownload = (item: QueueItem) => Promise<void>;

const completed: QueueItem = {
  id: "row-1",
  text: "une rivière",
  filename: "une_riviere",
  autoFilename: true,
  speed: 1,
  overrideSpeed: false,
  status: "completed",
  downloadUrl: "https://api.tts.ai/files/une_riviere.mp3",
  generatedWith: { speaker: "melotts:FR", speed: 1 },
};

function Table({ children }: { children: ReactNode }) {
  return (
    <table>
      <tbody>{children}</tbody>
    </table>
  );
}

const siwis: Voice = { key: "piper:siwis", id: "siwis", name: "Siwis", language: "fr", model: "piper" };

/** Renders one row with harmless defaults; returns the props so tests can check the callbacks. */
function renderRow(item: QueueItem, overrides: Partial<ComponentProps<typeof QueueRow>> = {}) {
  const props: ComponentProps<typeof QueueRow> = {
    item,
    index: 0,
    globalSpeed: 1,
    speakerEditable: false,
    assignedSpeaker: "French",
    arranged: { groups: [], shown: new Set() },
    voicesByKey: new Map(),
    outdated: false,
    locked: false,
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    onDownload: vi.fn<OnDownload>(() => Promise.resolve()),
    onPlay: vi.fn(),
    onSample: vi.fn(),
    onStopPlayback: vi.fn(),
    ...overrides,
  };
  render(<QueueRow {...props} />, { wrapper: Table });
  return props;
}

const button = (name: string) => screen.queryByRole("button", { name });
const downloadButton = () => button("Download");

afterEach(cleanup);

describe("QueueRow download button", () => {
  it("is shown for a completed row with audio", () => {
    renderRow(completed);
    expect(downloadButton()).not.toBeNull();
  });

  it.each<QueueStatus>(["pending", "queued", "processing", "failed"])("is hidden while the row is %s", (status) => {
    renderRow({ ...completed, status });
    expect(downloadButton()).toBeNull();
  });

  it("is hidden for a completed row without an audio URL", () => {
    renderRow({ ...completed, downloadUrl: undefined });
    expect(downloadButton()).toBeNull();
  });

  it("stays usable while other rows are generating", () => {
    renderRow(completed, { locked: true });
    expect(downloadButton()).toHaveProperty("disabled", false);
  });

  it("downloads the row and shows Saving… until the download finishes", async () => {
    let finish!: () => void;
    const onDownload = vi.fn<OnDownload>(() => new Promise<void>((resolve) => (finish = resolve)));
    renderRow(completed, { onDownload });

    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(onDownload).toHaveBeenCalledExactlyOnceWith(completed);
    expect(screen.getByRole("button", { name: "Saving…" })).toHaveProperty("disabled", true);

    await act(async () => finish());
    expect(downloadButton()).toHaveProperty("disabled", false);
  });
});

describe("QueueRow speaker picker", () => {
  const voices: Voice[] = [
    { key: "openvoice:FR", id: "FR", name: "French", language: "fr", model: "openvoice" },
    { key: "piper:siwis", id: "siwis", name: "Siwis", language: "fr", model: "piper" },
  ];

  it("follows the voice order in Per File mode", () => {
    renderRow(
      { ...completed, status: "pending" },
      {
        speakerEditable: true,
        arranged: arrangeVoiceList(voices, { testedOnly: false, byPrice: true, followsSpeed: false, byName: true }),
        voicesByKey: new Map(voices.map((voice) => [voice.key, voice])),
      },
    );
    const picker = screen.getByRole("combobox", { name: "Speaker, row 1" });
    expect([...picker.querySelectorAll("optgroup")].map((group) => group.label)).toEqual([
      "Free tier · 1 credit per character",
      "Premium · 4 credits per character",
    ]);
  });
});

describe("QueueRow Play button", () => {
  it("plays a completed row", () => {
    const { onPlay } = renderRow(completed);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(completed);
  });

  it.each<QueueStatus>(["pending", "queued", "processing", "failed"])("isn't shown while the row is %s", (status) => {
    renderRow({ ...completed, status });
    expect(button("Play")).toBeNull();
  });

  it("stays usable while other rows are generating", () => {
    renderRow(completed, { locked: true });
    expect(button("Play")).toHaveProperty("disabled", false);
  });

  it("turns into Stop while the clip plays", () => {
    const { onStopPlayback, onPlay } = renderRow(completed, { playback: "playing" });
    expect(button("Play")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStopPlayback).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("shows a spinner on Stop while the clip loads", () => {
    renderRow(completed, { playback: "loading" });
    expect(screen.getByRole("button", { name: "Stop" }).querySelector("svg.animate-spin")).not.toBeNull();
  });
});

describe("QueueRow Sample button", () => {
  const pending: QueueItem = { ...completed, status: "pending", downloadUrl: undefined, generatedWith: undefined };

  it("plays a sample of the voice a pending row will get", () => {
    const { onSample } = renderRow(pending, { sampleVoice: siwis });
    const sample = screen.getByRole("button", { name: "Sample" });
    expect(sample.getAttribute("title")).toContain(`Hear Siwis say “${SAMPLE_TEXT}”`);
    fireEvent.click(sample);
    expect(onSample).toHaveBeenCalledExactlyOnceWith(pending, siwis);
  });

  it("isn't shown when the voice isn't known yet, as in random mode", () => {
    renderRow(pending);
    expect(button("Sample")).toBeNull();
  });

  it.each<QueueStatus>(["queued", "processing", "completed", "failed"])("isn't shown while the row is %s", (status) => {
    renderRow({ ...completed, status }, { sampleVoice: siwis });
    expect(button("Sample")).toBeNull();
  });

  it("is disabled while audio is generating", () => {
    renderRow(pending, { sampleVoice: siwis, locked: true });
    expect(button("Sample")).toHaveProperty("disabled", true);
  });

  it("turns into Stop while the sample loads or plays", () => {
    const { onStopPlayback } = renderRow(pending, { sampleVoice: siwis, playback: "loading" });
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStopPlayback).toHaveBeenCalledTimes(1);
  });
});

describe("QueueRow downloaded mark", () => {
  const saved: QueueItem = { ...completed, downloadedUrl: completed.downloadUrl };

  it("reads Download again, in amber, once the file was saved", () => {
    renderRow(saved);
    const again = screen.getByRole("button", { name: "Download again" });
    expect(again.className).toContain("bg-amber-50");
    expect(again.getAttribute("title")).toBe("You saved this file already. Click to save it again.");
    expect(button("Download")).toBeNull();
  });

  it("still saves the file again when clicked", () => {
    const { onDownload } = renderRow(saved);
    fireEvent.click(screen.getByRole("button", { name: "Download again" }));
    expect(onDownload).toHaveBeenCalledExactlyOnceWith(saved);
  });

  it("goes back to a plain Download after regenerating, which gives the row a new link", () => {
    renderRow({ ...saved, downloadUrl: "https://cdn.tts.ai/new/tts_output.mp3" });
    expect(screen.getByRole("button", { name: "Download" }).className).not.toContain("bg-amber-50");
  });
});
