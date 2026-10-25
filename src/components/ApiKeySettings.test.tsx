// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SavedApiKey } from "../services/apiKey";
import { ApiKeySettings } from "./ApiKeySettings";

function renderBox(saved: SavedApiKey | undefined, hasBuiltInKey = false) {
  const onSave = vi.fn();
  const onForget = vi.fn();
  const view = render(<ApiKeySettings saved={saved} hasBuiltInKey={hasBuiltInKey} onSave={onSave} onForget={onForget} />);
  return { onSave, onForget, view };
}

const keyInput = () => screen.getByLabelText("TTS.ai API key");
const button = (name: string) => screen.queryByRole("button", { name });

afterEach(cleanup);

describe("ApiKeySettings", () => {
  it("asks for a key when there is none, hiding what is typed", () => {
    renderBox(undefined);
    expect(keyInput()).toHaveProperty("type", "password");
    expect(button("Save key")).toHaveProperty("disabled", true);
    expect(button("Cancel")).toBeNull();
    expect(screen.getByText(/only sent to TTS.ai/)).not.toBeNull();
  });

  it("saves the key for this tab, or on the device when Remember is ticked", () => {
    const { onSave } = renderBox(undefined);
    fireEvent.change(keyInput(), { target: { value: "  sk-visitor-1234 " } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    expect(onSave).toHaveBeenLastCalledWith("sk-visitor-1234", false);
  });

  it("passes Remember on, and saves with Enter", () => {
    const { onSave } = renderBox(undefined);
    fireEvent.change(keyInput(), { target: { value: "sk-visitor-1234" } });
    fireEvent.click(screen.getByLabelText("Remember on this device"));
    fireEvent.submit(keyInput());
    expect(onSave).toHaveBeenLastCalledWith("sk-visitor-1234", true);
  });

  it("shows only the end of a saved key, and where it is kept", () => {
    const { view } = renderBox({ key: "sk-visitor-1234", remembered: false });
    expect(view.container.textContent).toContain("••••1234");
    expect(view.container.textContent).not.toContain("sk-visitor");
    expect(view.container.textContent).toContain("kept until you close this tab");
    cleanup();
    renderBox({ key: "sk-visitor-1234", remembered: true });
    expect(screen.getByText(/remembered on this device/)).not.toBeNull();
  });

  it("forgets the key", () => {
    const { onForget } = renderBox({ key: "sk-visitor-1234", remembered: true });
    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    expect(onForget).toHaveBeenCalledTimes(1);
  });

  it("changes the key, keeping the Remember choice, or cancels", () => {
    renderBox({ key: "sk-visitor-1234", remembered: true });
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByLabelText("Remember on this device")).toHaveProperty("checked", true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("••••1234")).not.toBeNull();
  });

  it("asks again once the only key is forgotten", () => {
    const { view, onSave, onForget } = renderBox({ key: "sk-visitor-1234", remembered: false });
    view.rerender(<ApiKeySettings saved={undefined} hasBuiltInKey={false} onSave={onSave} onForget={onForget} />);
    expect(keyInput()).not.toBeNull();
  });

  it("says when the key comes from .env, and lets the visitor use their own", () => {
    renderBox(undefined, true);
    expect(screen.getByText(/VITE_TTS_API_KEY/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use my own key" }));
    expect(keyInput()).not.toBeNull();
    expect(button("Cancel")).not.toBeNull();
  });
});
