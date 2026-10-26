// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpeakerConfig, Voice } from "../types/queue";
import { arrangeVoiceList, type LanguageSummary, type VoiceListOptions } from "../utils/voices";
import { SpeakerSettings } from "./SpeakerSettings";

// In TTS.ai's order. All but Xavier were tested; melotts and piper respond to speed.
const voices: Voice[] = [
  { key: "openvoice:FR", id: "FR", name: "French", language: "fr", model: "openvoice" },
  { key: "piper:fr_FR-siwis-medium", id: "fr_FR-siwis-medium", name: "Siwis", language: "fr", model: "piper" },
  { key: "melotts:FR", id: "FR", name: "Mélo", language: "fr", model: "melotts" },
  { key: "xtts:fr_test", id: "fr_test", name: "Xavier", language: "fr", model: "xtts" },
];

const OFF: VoiceListOptions = { testedOnly: false, byPrice: false, followsSpeed: false, byName: false };

function renderSettings(
  voiceList: Partial<VoiceListOptions>,
  config: SpeakerConfig = { mode: "random", selectedVoices: [] },
  {
    shown = voices,
    disabled = false,
    languages = [{ code: "fr", label: "French", count: shown.length, total: shown.length }],
  }: { shown?: Voice[]; disabled?: boolean; languages?: LanguageSummary[] } = {},
) {
  const options = { ...OFF, ...voiceList };
  const onVoiceListChange = vi.fn();
  const onConfigChange = vi.fn();
  render(
    <SpeakerSettings
      voiceStatus="ready"
      onRetryVoices={vi.fn()}
      arranged={arrangeVoiceList(shown, options)}
      voicesByKey={new Map(shown.map((voice) => [voice.key, voice]))}
      languages={languages}
      language="fr"
      onLanguageChange={vi.fn()}
      voiceList={options}
      onVoiceListChange={onVoiceListChange}
      config={config}
      onConfigChange={onConfigChange}
      globalSpeed={1}
      onGlobalSpeedChange={vi.fn()}
      disabled={disabled}
    />,
  );
  return { onVoiceListChange, onConfigChange };
}

/** The names in the voice pool, in the order shown. */
function pool(): string[] {
  return within(screen.getByRole("group", { name: "Voice pool" }))
    .getAllByRole("checkbox")
    .map((box) => box.closest("label")?.textContent ?? "");
}

afterEach(cleanup);

describe("Sort voices checkboxes", () => {
  it("shows the four boxes, ticked as given", () => {
    renderSettings({ testedOnly: true, byName: true });
    const sort = within(screen.getByRole("group", { name: "Sort voices" }));
    expect(sort.getAllByRole("checkbox").map((box) => [box.closest("label")?.textContent, (box as HTMLInputElement).checked])).toEqual([
      ["Tested voices only", true],
      ["Price, low to high", false],
      ["Responds to speed control", false],
      ["By name (A–Z)", true],
    ]);
  });

  it("reports a change to one box, keeping the others", () => {
    const { onVoiceListChange } = renderSettings({ testedOnly: true, byName: true });
    fireEvent.click(screen.getByLabelText("Price, low to high"));
    expect(onVoiceListChange).toHaveBeenCalledWith({ testedOnly: true, byPrice: true, followsSpeed: false, byName: true });
  });

  it("can't be changed while audio is generating", () => {
    renderSettings({ byName: true }, undefined, { disabled: true });
    expect(screen.getByLabelText("By name (A–Z)")).toHaveProperty("disabled", true);
  });
});

describe("the voice pool under Sort voices", () => {
  it("keeps TTS.ai's order with every box off", () => {
    renderSettings({});
    expect(pool()).toEqual(["French (openvoice) · ignores speed", "Siwis (piper)", "Mélo (melotts)", "Xavier (xtts)"]);
  });

  it("lists A–Z by name", () => {
    renderSettings({ byName: true });
    expect(pool()).toEqual(["French (openvoice) · ignores speed", "Mélo (melotts)", "Siwis (piper)", "Xavier (xtts)"]);
  });

  it("groups by price, cheapest first, A–Z inside each group", () => {
    renderSettings({ byPrice: true, byName: true });
    const group = (name: string) =>
      within(screen.getByRole("list", { name })).getAllByRole("checkbox").map((box) => box.closest("label")?.textContent);
    expect(group("Free tier · 1 credit per character")).toEqual(["Mélo (melotts)", "Siwis (piper)"]);
    expect(group("Premium · 4 credits per character")).toEqual(["French (openvoice) · ignores speed"]);
    expect(group("Price not known yet")).toEqual(["Xavier (xtts)"]);
    expect(screen.getByText(/Prices come from TTS.ai's docs/)).not.toBeNull();
  });

  it("hides voices that weren't tested", () => {
    renderSettings({ testedOnly: true, byName: true });
    expect(pool()).toEqual(["French (openvoice) · ignores speed", "Mélo (melotts)", "Siwis (piper)"]);
    expect(screen.getByText(/Tested: the French voices checked/)).not.toBeNull();
  });

  it("keeps only voices that respond to speed control", () => {
    renderSettings({ followsSpeed: true, byName: true });
    expect(pool()).toEqual(["Mélo (melotts)", "Siwis (piper)"]);
    expect(screen.getByText(/Responds to speed: kokoro, melotts and piper/)).not.toBeNull();
  });

  it("combines all four", () => {
    renderSettings({ testedOnly: true, byPrice: true, followsSpeed: true, byName: true });
    expect(screen.getByRole("list", { name: "Free tier · 1 credit per character" })).not.toBeNull();
    expect(pool()).toEqual(["Mélo (melotts)", "Siwis (piper)"]);
  });

  it("says why when the boxes leave nothing", () => {
    renderSettings({ testedOnly: true }, undefined, { shown: voices.slice(3) });
    expect(screen.getByText("No tested voices here. Only French voices have been tested so far.")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Select all shown" })).toHaveProperty("disabled", true);
  });

  it("selects all shown voices in the order the list shows them", () => {
    const { onConfigChange } = renderSettings({ byPrice: true, byName: true }, { mode: "roundRobin", selectedVoices: [] });
    fireEvent.click(screen.getByRole("button", { name: "Select all shown" }));
    expect(onConfigChange).toHaveBeenCalledWith({
      mode: "roundRobin",
      selectedVoices: ["melotts:FR", "piper:fr_FR-siwis-medium", "openvoice:FR", "xtts:fr_test"],
    });
  });

  it("selects only what the boxes let through, keeping earlier picks first", () => {
    const { onConfigChange } = renderSettings({ followsSpeed: true, byName: true }, { mode: "roundRobin", selectedVoices: ["openvoice:FR"] });
    fireEvent.click(screen.getByRole("button", { name: "Select all shown" }));
    expect(onConfigChange).toHaveBeenCalledWith({
      mode: "roundRobin",
      selectedVoices: ["openvoice:FR", "melotts:FR", "piper:fr_FR-siwis-medium"],
    });
  });

  it("applies to the single-speaker picker too", () => {
    renderSettings({ byPrice: true, byName: true }, { mode: "single", selectedVoices: [] });
    const picker = screen.getByLabelText("Speaker for every file");
    expect([...picker.querySelectorAll("optgroup")].map((group) => group.label)).toEqual([
      "Free tier · 1 credit per character",
      "Premium · 4 credits per character",
      "Price not known yet",
    ]);
  });
});

describe("voices you picked that the boxes now hide", () => {
  const random = (selectedVoices: string[]): SpeakerConfig => ({ mode: "random", selectedVoices });
  const hiddenPicks = () => screen.queryByRole("list", { name: "Selected, but hidden by the language or Sort voices" });

  it("keep a ticked checkbox in a group of their own, first", () => {
    renderSettings({ followsSpeed: true, byName: true }, random(["openvoice:FR"]));
    const group = hiddenPicks();
    expect(group).not.toBeNull();
    const [box] = within(group as HTMLElement).getAllByRole("checkbox");
    expect(box?.closest("label")?.textContent).toBe("French (openvoice) · ignores speed");
    expect(box).toHaveProperty("checked", true);
    expect(pool()[0]).toBe("French (openvoice) · ignores speed");
  });

  it("can be unticked, which takes them out of the pool", () => {
    const { onConfigChange } = renderSettings({ followsSpeed: true, byName: true }, random(["openvoice:FR", "melotts:FR"]));
    fireEvent.click(within(hiddenPicks() as HTMLElement).getByRole("checkbox"));
    expect(onConfigChange).toHaveBeenCalledWith(random(["melotts:FR"]));
  });

  it("still show when nothing else is left, with the reason", () => {
    renderSettings({ testedOnly: true }, random(["xtts:fr_test"]), { shown: voices.slice(3) });
    expect(within(hiddenPicks() as HTMLElement).getByRole("checkbox").closest("label")?.textContent).toBe("Xavier (xtts)");
    expect(screen.getByText("No tested voices here. Only French voices have been tested so far.")).not.toBeNull();
  });

  it("show a name even for a voice the app no longer offers at all", () => {
    renderSettings({ byName: true }, random(["bark:v2/fr_speaker_0"]));
    expect(within(hiddenPicks() as HTMLElement).getByRole("checkbox").closest("label")?.textContent).toBe("French Speaker 1");
  });

  it("aren't listed twice when the boxes let them through", () => {
    renderSettings({ byName: true }, random(["melotts:FR"]));
    expect(hiddenPicks()).toBeNull();
  });
});

describe("language counts", () => {
  it("count the voices the Sort voices boxes let through, out of all of them", () => {
    renderSettings({ testedOnly: true, byName: true }, undefined, {
      languages: [
        { code: "en", label: "English", count: 0, total: 40 },
        { code: "fr", label: "French", count: 8, total: 8 },
      ],
    });
    const options = [...screen.getByLabelText("Voice language").querySelectorAll("option")].map((option) => option.textContent);
    expect(options).toEqual(["All languages (8 of 48)", "English (0 of 40)", "French (8)"]);
    expect(screen.getByText("48 voices loaded, 8 let through by Sort voices. Both apply to every speaker list.")).not.toBeNull();
  });

  it("say plainly when every voice is shown", () => {
    renderSettings({ byName: true });
    expect(screen.getByText("4 voices loaded. The language and Sort voices apply to every speaker list.")).not.toBeNull();
  });
});
