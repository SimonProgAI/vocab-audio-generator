// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./Button";

afterEach(cleanup);

const classesOf = (name: string) => screen.getByRole("button", { name }).className.split(" ");

describe("Button", () => {
  it("is a plain button by default, so it never submits a form by accident", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("type", "button");
  });

  it("gives secondary buttons a clearly darker hover and an even darker press", () => {
    render(<Button>Download</Button>);
    expect(classesOf("Download")).toEqual(
      expect.arrayContaining(["enabled:hover:bg-slate-200", "enabled:hover:border-slate-400", "enabled:active:bg-slate-300"]),
    );
  });

  it.each(["primary", "secondary", "danger", "ghost", "repeat"] as const)(
    "presses down on click (%s), unless the system asks for less motion",
    (variant) => {
      render(<Button variant={variant}>Go</Button>);
      expect(classesOf("Go")).toEqual(expect.arrayContaining(["transition", "motion-safe:enabled:active:scale-95"]));
      expect(classesOf("Go")).not.toContain("active:scale-95");
    },
  );

  it("reacts to hover and press only when it can be clicked", () => {
    render(<Button variant="primary">Go</Button>);
    const stateClasses = classesOf("Go").filter((name) => /(^|:)(hover|active):/.test(name));
    expect(stateClasses.length).toBeGreaterThan(0);
    expect(stateClasses.every((name) => name.includes("enabled:"))).toBe(true);
  });

  it("has an amber variant for actions already done once", () => {
    render(<Button variant="repeat">Download again</Button>);
    expect(classesOf("Download again")).toEqual(
      expect.arrayContaining(["border-amber-300", "bg-amber-50", "text-amber-800", "enabled:hover:bg-amber-100"]),
    );
  });
});
