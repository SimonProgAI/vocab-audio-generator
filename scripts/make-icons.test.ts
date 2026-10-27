import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ICON_BLUE, ICON_FILES, ICON_PATH, ICON_RADIUS, REPO_ROOT, encodePng, readBars, renderIcon } from "./make-icons.ts";

/** RGBA of the pixel at (x, y). */
function pixel(rgba: Uint8Array, size: number, x: number, y: number): number[] {
  const at = (y * size + x) * 4;
  return [...rgba.subarray(at, at + 4)];
}

/**
 * Size and RGBA pixels of a PNG from encodePng. Compares pixels, not file bytes: another zlib
 * (a different Node, as in CI) may compress the same pixels differently.
 */
function readPng(png: Buffer): { width: number; height: number; rgba: Uint8Array } {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks: Array<{ type: string; data: Buffer }> = [];
  for (let at = 8; at < png.length; at += 12 + png.readUInt32BE(at)) {
    const length = png.readUInt32BE(at);
    chunks.push({ type: png.subarray(at + 4, at + 8).toString("latin1"), data: png.subarray(at + 8, at + 8 + length) });
  }
  expect(chunks.map(({ type }) => type)).toEqual(["IHDR", "IDAT", "IEND"]);
  const [header, idat] = chunks.map(({ data }) => data);
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  expect([...header.subarray(8, 13)]).toEqual([8, 6, 0, 0, 0]); // 8-bit RGBA, no interlace

  const rows = inflateSync(idat);
  const stride = width * 4;
  const rgba = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    expect(rows[y * (stride + 1)]).toBe(0); // no filter
    rgba.set(rows.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { width, height, rgba };
}

const fromRoot = (path: string) => new URL(path, REPO_ROOT);
const hex = (rgb: readonly number[]) => `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;

const BLUE = [...ICON_BLUE, 255];
const WHITE = [255, 255, 255, 255];

describe("renderIcon", () => {
  const size = 48; // One pixel per drawing unit, so coordinates match favicon.svg.
  const rounded = renderIcon(size, { rounded: true });

  it("draws the blue square, transparent outside its rounded corners", () => {
    expect(pixel(rounded, size, 0, 0)[3]).toBe(0);
    expect(pixel(rounded, size, 24, 2)).toEqual(BLUE);
  });

  it("draws the five white bars: the middle one tallest, with gaps between them", () => {
    expect(pixel(rounded, size, 23, 24)).toEqual(WHITE); // middle bar (x 12 + 12)
    expect(pixel(rounded, size, 23, 17)).toEqual(WHITE); // it reaches up to y 4 + 12
    expect(pixel(rounded, size, 15, 24)).toEqual(WHITE); // first bar (x 4 + 12)
    expect(pixel(rounded, size, 15, 19)).toEqual(BLUE); // ...which is short: y 10 to 14
    expect(pixel(rounded, size, 17, 24)).toEqual(BLUE); // gap between the first two bars
  });

  it("fills the whole square for the home-screen icon, which iOS rounds itself", () => {
    const square = renderIcon(size, { rounded: false });
    expect(pixel(square, size, 0, 0)).toEqual(BLUE);
    expect(pixel(square, size, 47, 47)).toEqual(BLUE);
  });
});

describe("readBars", () => {
  it("reads each vertical line of the path as x, top and bottom", () => {
    expect(readBars("M4 10v4M12 4v16")).toEqual([
      [4, 10, 14],
      [12, 4, 20],
    ]);
  });

  it("refuses a path it can't draw, instead of leaving bars out", () => {
    expect(() => readBars("M4 10v4M8 7h10")).toThrow("Expected only vertical lines");
    expect(() => readBars("")).toThrow("Expected only vertical lines");
  });
});

describe("encodePng", () => {
  it("writes a PNG whose size and pixels read back exactly", () => {
    const rgba = renderIcon(32, { rounded: true });
    expect(readPng(encodePng(32, 32, rgba))).toEqual({ width: 32, height: 32, rgba });
  });
});

describe("the committed icons", () => {
  it.each(ICON_FILES.map((file) => [file.path, file] as const))("%s has what npm run icons draws", (_path, { path, size, rounded }) => {
    expect(readPng(readFileSync(fromRoot(path)))).toEqual({ width: size, height: size, rgba: renderIcon(size, { rounded }) });
  });

  it("all draw the header icon: same bars, Tailwind's blue-600, rounded-lg corners", () => {
    const header = readFileSync(fromRoot("src/App.tsx"), "utf8");
    expect(header).toContain(`d="${ICON_PATH}"`);
    expect(header).toContain("rounded-lg bg-blue-600");

    const svg = readFileSync(fromRoot("public/favicon.svg"), "utf8");
    expect(svg).toContain(`d="${ICON_PATH}"`);
    expect(svg).toContain(`fill="${hex(ICON_BLUE)}"`);
    expect(svg).toContain(`rx="${ICON_RADIUS}"`);
  });

  it("are linked from index.html, PNG first so browsers that read SVG still choose it", () => {
    const html = readFileSync(fromRoot("index.html"), "utf8");
    const links = [...html.matchAll(/<link rel="((?:apple-touch-)?icon)"[^>]*href="([^"]+)"/g)].map(([, rel, href]) => `${rel} ${href}`);
    expect(links).toEqual(["icon /favicon-32.png", "icon /favicon.svg", "apple-touch-icon /apple-touch-icon.png"]);
  });
});
