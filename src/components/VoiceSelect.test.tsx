// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Voice } from "../types/queue";
import type { VoiceOrder } from "../utils/voices";
import { VoiceSelect } from "./VoiceSelect";

const piper: Voice = { key: "piper:siwis", id: "siwis", name: "Siwis", language: "fr", model: "piper" };
const openvoice: Voice = { key: "openvoice:FR", id: "FR", name: "French", language: "fr", model: "openvoice" };
const bark: Voice = { key: "bark:en_0", id: "en_0", name: "English Male", language: "en", model: "bark" };
const voicesByKey = new Map([piper, openvoice, bark].map((voice) => [voice.key, voice]));

function renderSelect(order: VoiceOrder, { voices = [openvoice, piper], value }: { voices?: Voice[]; value?: string } = {}) {
  const onChange = vi.fn();
  render(
    <VoiceSelect
      voices={voices}
      voicesByKey={voicesByKey}
      order={order}
      value={value}
      onChange={onChange}
      placeholder="Choose…"
      ariaLabel="Speaker"
    />,
  );
  return onChange;
}

/** Each optgroup's label with its options, or "(no group)" for options outside one. */
function structure(): Array<[string, string[]]> {
  const select = screen.getByRole("combobox", { name: "Speaker" });
  const groups = [...select.querySelectorAll("optgroup")].map(
    (group): [string, string[]] => [group.label, [...group.querySelectorAll("option")].map((option) => option.text)],
  );
  const loose = [...select.children]
    .filter((child) => child.tagName === "OPTION" && !(child as HTMLOptionElement).disabled)
    .map((option) => (option as HTMLOptionElement).text);
  return loose.length > 0 ? [["(no group)", loose], ...groups] : groups;
}

afterEach(cleanup);

describe("VoiceSelect", () => {
  it("lists voices without groups when sorted by name", () => {
    renderSelect("name");
    expect(structure()).toEqual([["(no group)", ["French (openvoice) · ignores speed", "Siwis (piper)"]]]);
  });

  it("groups voices by price tier, cheapest first", () => {
    renderSelect("tier");
    expect(structure()).toEqual([
      ["Free tier · 1 credit per character", ["Siwis (piper)"]],
      ["Premium · 4 credits per character", ["French (openvoice) · ignores speed"]],
    ]);
  });

  it("keeps a chosen voice hidden by the language filter, in its tier", () => {
    renderSelect("tier", { value: bark.key });
    expect(structure()).toEqual([
      ["Free tier · 1 credit per character", ["Siwis (piper)"]],
      ["Standard · 2 credits per character", ["English Male (bark)"]],
      ["Premium · 4 credits per character", ["French (openvoice) · ignores speed"]],
    ]);
    expect(screen.getByRole("combobox", { name: "Speaker" })).toHaveProperty("value", bark.key);
  });

  it("reports the chosen voice key from inside a group", () => {
    const onChange = renderSelect("tier");
    fireEvent.change(screen.getByRole("combobox", { name: "Speaker" }), { target: { value: piper.key } });
    expect(onChange).toHaveBeenCalledWith(piper.key);
  });
});
