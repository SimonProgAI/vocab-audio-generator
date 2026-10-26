import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ICON_BLUE, ICON_FILES, encodePng, renderIcon } from "./make-icons";

/** RGBA of the pixel at (x, y). */
function pixel(rgba: Uint8Array, size: number, x: number, y: number): number[] {
  const at = (y * size + x) * 4;
  return [...rgba.subarray(at, at + 4)];
}

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

describe("encodePng", () => {
  it("writes a PNG whose header and pixels read back exactly", () => {
    const rgba = renderIcon(32, { rounded: true });
    const png = encodePng(32, 32, rgba);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(12, 16).toString("latin1")).toBe("IHDR");
    expect([png.readUInt32BE(16), png.readUInt32BE(20), png[24], png[25]]).toEqual([32, 32, 8, 6]);

    const idatLength = png.readUInt32BE(33);
    expect(png.subarray(37, 41).toString("latin1")).toBe("IDAT");
    const rows = inflateSync(png.subarray(41, 41 + idatLength));
    const unfiltered = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y += 1) {
      expect(rows[y * 129]).toBe(0);
      unfiltered.set(rows.subarray(y * 129 + 1, (y + 1) * 129), y * 128);
    }
    expect(unfiltered).toEqual(rgba);
    expect(png.subarray(png.length - 8, png.length - 4).toString("latin1")).toBe("IEND");
  });
});

describe("the committed icons", () => {
  it.each(ICON_FILES.map((file) => [file.path, file] as const))("%s is what npm run icons draws", (_path, { path, size, rounded }) => {
    expect(readFileSync(path).equals(encodePng(size, size, renderIcon(size, { rounded })))).toBe(true);
  });

  it("favicon.svg draws the header icon: same bars, Tailwind's blue-600, rounded-lg corners", () => {
    const svg = readFileSync("public/favicon.svg", "utf8");
    const headerPath = /<path strokeLinecap="round" d="([^"]+)"/.exec(readFileSync("src/App.tsx", "utf8"))?.[1];
    expect(headerPath).toBe("M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4");
    expect(svg).toContain(`d="${headerPath}"`);
    expect(svg).toContain('fill="#155dfc"');
    expect(svg).toContain('rx="9.6"');
  });

  it("are linked from index.html, PNG first so browsers that read SVG still choose it", () => {
    const html = readFileSync("index.html", "utf8");
    const links = [...html.matchAll(/<link rel="([^"]+)"[^>]*href="([^"]+)"/g)].map(([, rel, href]) => `${rel} ${href}`);
    expect(links).toEqual(["icon /favicon-32.png", "icon /favicon.svg", "apple-touch-icon /apple-touch-icon.png"]);
  });
});
