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

function renderWith(shown: Voice[], voiceOrder: VoiceOrder, config: SpeakerConfig) {
  const onConfigChange = vi.fn();
  render(
    <SpeakerSettings
      voiceStatus="ready"
      onRetryVoices={vi.fn()}
      voices={shown}
      voicesByKey={new Map(shown.map((voice) => [voice.key, voice]))}
      languages={[{ code: "fr", label: "French", count: shown.length }]}
      language="fr"
      onLanguageChange={vi.fn()}
      voiceOrder={voiceOrder}
      onVoiceOrderChange={vi.fn()}
      config={config}
      onConfigChange={onConfigChange}
      globalSpeed={1}
      onGlobalSpeedChange={vi.fn()}
      disabled={false}
    />,
  );
  return onConfigChange;
}

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
    expect(within(premium).getByRole("checkbox").closest("label")?.textContent).toBe("French (openvoice) · ignores speed");
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

describe("SpeakerSettings Follows speed", () => {
  it("offers the option and reports it", () => {
    const { onVoiceOrderChange } = renderSettings("name");
    const options = [...screen.getByLabelText("Sort voices").querySelectorAll("option")].map((option) => option.textContent);
    expect(options).toEqual(["By name", "By price, free tier first", "Follows speed, by price"]);
    fireEvent.change(screen.getByLabelText("Sort voices"), { target: { value: "followsSpeed" } });
    expect(onVoiceOrderChange).toHaveBeenCalledWith("followsSpeed");
  });

  it("lists only voices known to follow speed, and explains why", () => {
    renderSettings("followsSpeed");
    expect(screen.getAllByRole("checkbox").map((box) => box.closest("label")?.textContent)).toEqual(["Mélo (melotts)"]);
    expect(screen.getByText(/Only voices a check found to follow the speed setting/)).not.toBeNull();
  });

  it("selects all of those, and only those", () => {
    const onConfigChange = renderWith(voices, "followsSpeed", { mode: "roundRobin", selectedVoices: [] });
    fireEvent.click(screen.getByRole("button", { name: "Select all shown" }));
    expect(onConfigChange).toHaveBeenCalledWith({ mode: "roundRobin", selectedVoices: ["melotts:FR"] });
  });

  it("says so when none of the shown voices follows speed", () => {
    renderWith(voices.slice(0, 1), "followsSpeed", { mode: "random", selectedVoices: [] });
    expect(screen.getByText("None of these voices is known to follow the speed setting.")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Select all shown" })).toHaveProperty("disabled", true);
  });
});
