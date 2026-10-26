// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Voice } from "../types/queue";
import type { VoiceListOptions } from "../utils/voices";
import { VoiceSelect } from "./VoiceSelect";

const piper: Voice = { key: "piper:fr_FR-siwis-medium", id: "fr_FR-siwis-medium", name: "Siwis", language: "fr", model: "piper" };
const openvoice: Voice = { key: "openvoice:FR", id: "FR", name: "French", language: "fr", model: "openvoice" };
const bark: Voice = { key: "bark:en_0", id: "en_0", name: "English Male", language: "en", model: "bark" };
const voicesByKey = new Map([piper, openvoice, bark].map((voice) => [voice.key, voice]));

const BY_NAME: VoiceListOptions = { testedOnly: false, byPrice: false, followsSpeed: false, byName: true };
const BY_PRICE: VoiceListOptions = { ...BY_NAME, byPrice: true };

function renderSelect(
  voiceList: VoiceListOptions,
  { voices = [piper, openvoice], value }: { voices?: Voice[]; value?: string } = {},
) {
  const onChange = vi.fn();
  render(
    <VoiceSelect
      voices={voices}
      voicesByKey={voicesByKey}
      voiceList={voiceList}
      value={value}
      onChange={onChange}
      placeholder="Choose…"
      ariaLabel="Speaker"
    />,
  );
  return onChange;
}

const select = () => screen.getByRole("combobox", { name: "Speaker" });

/** Each optgroup's label with its options, or "(no group)" for options outside one. */
function structure(): Array<[string, string[]]> {
  const groups = [...select().querySelectorAll("optgroup")].map(
    (group): [string, string[]] => [group.label, [...group.querySelectorAll("option")].map((option) => option.text)],
  );
  const loose = [...select().children]
    .filter((child) => child.tagName === "OPTION" && !(child as HTMLOptionElement).disabled)
    .map((option) => (option as HTMLOptionElement).text);
  return loose.length > 0 ? [["(no group)", loose], ...groups] : groups;
}

afterEach(cleanup);

describe("VoiceSelect", () => {
  it("lists voices A–Z without groups when sorted by name", () => {
    renderSelect(BY_NAME);
    expect(structure()).toEqual([["(no group)", ["French (openvoice) · ignores speed", "Siwis (piper)"]]]);
  });

  it("keeps TTS.ai's order when By name is off", () => {
    renderSelect({ ...BY_NAME, byName: false });
    expect(structure()).toEqual([["(no group)", ["Siwis (piper)", "French (openvoice) · ignores speed"]]]);
  });

  it("groups voices by price tier, cheapest first", () => {
    renderSelect(BY_PRICE);
    expect(structure()).toEqual([
      ["Free tier · 1 credit per character", ["Siwis (piper)"]],
      ["Premium · 4 credits per character", ["French (openvoice) · ignores speed"]],
    ]);
  });

  it("keeps a chosen voice that the language or the boxes hide, first", () => {
    renderSelect(BY_PRICE, { value: bark.key });
    expect(structure()).toEqual([
      ["(no group)", ["English Male (bark)"]],
      ["Free tier · 1 credit per character", ["Siwis (piper)"]],
      ["Premium · 4 credits per character", ["French (openvoice) · ignores speed"]],
    ]);
    expect(select()).toHaveProperty("value", bark.key);
  });

  it("doesn't list the chosen voice twice when the boxes let it through", () => {
    renderSelect(BY_NAME, { value: piper.key });
    expect(structure()).toEqual([["(no group)", ["French (openvoice) · ignores speed", "Siwis (piper)"]]]);
  });

  it("says why when the boxes leave nothing", () => {
    renderSelect({ ...BY_NAME, testedOnly: true }, { voices: [bark] });
    const options = [...select().querySelectorAll("option")];
    expect(options.map((option) => [option.text, option.disabled])).toEqual([
      ["Choose…", true],
      ["No tested voices here. Only French voices have been tested so far.", true],
    ]);
  });

  it("reports the chosen voice key from inside a group", () => {
    const onChange = renderSelect(BY_PRICE);
    fireEvent.change(select(), { target: { value: piper.key } });
    expect(onChange).toHaveBeenCalledWith(piper.key);
  });
});
