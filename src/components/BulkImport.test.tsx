// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BulkImport } from "./BulkImport";

function renderBox(draft: string) {
  const onDraftChange = vi.fn();
  const onAdd = vi.fn();
  render(<BulkImport draft={draft} onDraftChange={onDraftChange} onAdd={onAdd} />);
  return { onDraftChange, onAdd, box: screen.getByLabelText("Vocabulary list") };
}

afterEach(cleanup);

describe("BulkImport", () => {
  it("shows the text it's given and reports every edit", () => {
    const { box, onDraftChange } = renderBox("une ferme");
    expect(box).toHaveProperty("value", "une ferme");
    fireEvent.change(box, { target: { value: "une ferme\nun champ" } });
    expect(onDraftChange).toHaveBeenCalledWith("une ferme\nun champ");
  });

  it("adds one entry per non-blank line, keeping only the first spreadsheet column, then empties the box", () => {
    const { onAdd, onDraftChange } = renderBox("une ferme\tfarm\n\n  un champ  \n\t\nun village");
    expect(screen.getByText("3 lines ready to add.")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add To Queue" }));

    expect(onAdd).toHaveBeenCalledWith(["une ferme", "un champ", "un village"]);
    expect(onDraftChange).toHaveBeenCalledWith("");
  });

  it("adds with Ctrl+Enter", () => {
    const { box, onAdd } = renderBox("une rivière");
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    expect(onAdd).toHaveBeenCalledWith(["une rivière"]);
  });

  it("has nothing to add when every line is blank", () => {
    const { box, onAdd } = renderBox("  \n\t\n");
    expect(screen.getByRole("button", { name: "Add To Queue" })).toHaveProperty("disabled", true);
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    expect(onAdd).not.toHaveBeenCalled();
  });
});
