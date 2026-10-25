// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpeakerConfig, Voice } from "../types/queue";
import type { VoiceOrder } from "../utils/voices";
import { SpeakerSettings } from "./SpeakerSettings";

const voices: Voice[] = [
  { key: "openvoice:FR", id: "FR", name: "French", language: "fr", model: "openvoice" },
  { key: "piper:siwis", id: "siwis", name: "Siwis", language: "fr", model: "piper" },
  { key: "melotts:FR", id: "FR", name: "Mélo", language: "fr", model: "melotts" },
];

function renderSettings(voiceOrder: VoiceOrder, config: SpeakerConfig = { mode: "random", selectedVoices: [] }) {
  const onVoiceOrderChange = vi.fn();
  const onConfigChange = vi.fn();
  render(
    <SpeakerSettings
      voiceStatus="ready"
      onRetryVoices={vi.fn()}
      voices={voices}
      voicesByKey={new Map(voices.map((voice) => [voice.key, voice]))}
      languages={[{ code: "fr", label: "French", count: voices.length }]}
      language="fr"
      onLanguageChange={vi.fn()}
      voiceOrder={voiceOrder}
      onVoiceOrderChange={onVoiceOrderChange}
      config={config}
      onConfigChange={onConfigChange}
      globalSpeed={1}
      onGlobalSpeedChange={vi.fn()}
      disabled={false}
    />,
  );
  return { onVoiceOrderChange, onConfigChange };
}

afterEach(cleanup);

describe("SpeakerSettings voice sorting", () => {
  it("reports the chosen order", () => {
    const { onVoiceOrderChange } = renderSettings("name");
    fireEvent.change(screen.getByLabelText("Sort voices"), { target: { value: "tier" } });
    expect(onVoiceOrderChange).toHaveBeenCalledWith("tier");
  });

  it("groups the voice pool by tier when sorting by price", () => {
    renderSettings("tier");
    const free = screen.getByRole("list", { name: "Free tier · 1 credit per character" });
    const premium = screen.getByRole("list", { name: "Premium · 4 credits per character" });
    expect(within(free).getAllByRole("checkbox").map((box) => box.closest("label")?.textContent)).toEqual([
      "Siwis (piper)",
      "Mélo (melotts)",
    ]);
    expect(within(premium).getByRole("checkbox").closest("label")?.textContent).toBe("French (openvoice)");
    expect(screen.getByText(/Prices come from TTS.ai's docs/)).not.toBeNull();
  });

  it("shows one flat voice pool when sorting by name", () => {
    renderSettings("name");
    expect(screen.queryByText("Free tier · 1 credit per character")).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("selects all shown voices in the order the list shows them", () => {
    const { onConfigChange } = renderSettings("tier", { mode: "roundRobin", selectedVoices: [] });
    fireEvent.click(screen.getByRole("button", { name: "Select all shown" }));
    expect(onConfigChange).toHaveBeenCalledWith({
      mode: "roundRobin",
      selectedVoices: ["piper:siwis", "melotts:FR", "openvoice:FR"],
    });
  });

  it("keeps already selected voices first when selecting all", () => {
    const { onConfigChange } = renderSettings("tier", { mode: "roundRobin", selectedVoices: ["openvoice:FR"] });
    fireEvent.click(screen.getByRole("button", { name: "Select all shown" }));
    expect(onConfigChange).toHaveBeenCalledWith({
      mode: "roundRobin",
      selectedVoices: ["openvoice:FR", "piper:siwis", "melotts:FR"],
    });
  });

  it("groups the single-speaker picker too", () => {
    renderSettings("tier", { mode: "single", selectedVoices: [] });
    const picker = screen.getByLabelText("Speaker for every file");
    expect([...picker.querySelectorAll("optgroup")].map((group) => group.label)).toEqual([
      "Free tier · 1 credit per character",
      "Premium · 4 credits per character",
    ]);
  });
});
