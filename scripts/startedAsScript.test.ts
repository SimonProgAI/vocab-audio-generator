import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { startedAsScript } from "./startedAsScript.ts";

// A throwaway folder: real/tool.ts, and link/ pointing at real/ (a junction on Windows).
const folder = mkdtempSync(join(tmpdir(), "started-as-script-"));
mkdirSync(join(folder, "real"));
writeFileSync(join(folder, "real", "tool.ts"), "");
writeFileSync(join(folder, "real", "other.ts"), "");
symlinkSync(join(folder, "real"), join(folder, "link"), "junction");
const toolUrl = pathToFileURL(realpathSync(join(folder, "real", "tool.ts"))).href;

afterAll(() => rmSync(folder, { recursive: true, force: true }));

describe("startedAsScript", () => {
  it("is true for the file node was started with", () => {
    expect(startedAsScript(toolUrl, join(folder, "real", "tool.ts"))).toBe(true);
  });

  it("is true when node was started through a folder link, which Node resolves", () => {
    expect(startedAsScript(toolUrl, join(folder, "link", "tool.ts"))).toBe(true);
  });

  it("is false for another file, or one that isn't on disk", () => {
    expect(startedAsScript(toolUrl, join(folder, "real", "other.ts"))).toBe(false);
    expect(startedAsScript(toolUrl, join(folder, "real", "missing.ts"))).toBe(false);
  });

  it("is false when a test imports the module, since node was started with the test runner", () => {
    expect(startedAsScript(import.meta.url)).toBe(false);
  });
});
