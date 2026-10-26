/**
 * Draws the PNG versions of the app icon, for browsers that don't use SVG favicons and for
 * iPhone home screens. Same shapes as public/favicon.svg and the header icon in App.tsx:
 * a blue rounded square with five white sound-wave bars.
 *
 *   npm run icons
 *
 * Writes public/favicon-32.png (rounded corners, transparent outside) and
 * public/apple-touch-icon.png (full square: iOS rounds the corners itself).
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { crc32, deflateSync } from "node:zlib";

/** Tailwind's blue-600, oklch(54.6% 0.245 262.881), as sRGB. */
export const ICON_BLUE: readonly [number, number, number] = [0x15, 0x5d, 0xfc];

/** Drawing units, as in favicon.svg: a 48-unit square with 9.6-unit corners (Tailwind's rounded-lg on 40 px). */
const BOX = 48;
const RADIUS = 9.6;
/** The header's 24-unit icon sits at half the square's size, centered. */
const ICON_OFFSET = 12;
/** Bars as x, top y, bottom y in the 24-unit icon (path M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4). */
const BARS: ReadonlyArray<readonly [number, number, number]> = [
  [4, 10, 14],
  [8, 7, 17],
  [12, 4, 20],
  [16, 7, 17],
  [20, 10, 14],
];
/** Half of stroke-width 2. Round caps, like stroke-linecap="round". */
const HALF_STROKE = 1;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Signed distance from (u, v) to the square's edge: negative inside. */
function squareDistance(u: number, v: number, radius: number): number {
  const qx = Math.abs(u - BOX / 2) - (BOX / 2 - radius);
  const qy = Math.abs(v - BOX / 2) - (BOX / 2 - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Signed distance from (u, v) to the nearest bar's outline: negative inside. */
function barDistance(u: number, v: number): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const [x, top, bottom] of BARS) {
    const along = Math.min(Math.max(v, ICON_OFFSET + top), ICON_OFFSET + bottom);
    nearest = Math.min(nearest, Math.hypot(u - (ICON_OFFSET + x), v - along) - HALF_STROKE);
  }
  return nearest;
}

/**
 * RGBA pixels of a `size`×`size` icon, anti-aliased: each pixel's coverage comes from its
 * distance to the shapes' edges. `rounded: false` fills the whole square.
 */
export function renderIcon(size: number, { rounded }: { rounded: boolean }): Uint8Array {
  const scale = size / BOX;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / scale;
      const v = (y + 0.5) / scale;
      const square = clamp01(0.5 - squareDistance(u, v, rounded ? RADIUS : 0) * scale);
      const bar = clamp01(0.5 - barDistance(u, v) * scale);
      const at = (y * size + x) * 4;
      ICON_BLUE.forEach((channel, i) => {
        pixels[at + i] = Math.round(channel + (255 - channel) * bar);
      });
      pixels[at + 3] = Math.round(square * 255);
    }
  }
  return pixels;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A PNG file of 8-bit RGBA pixels (no filtering; zlib does the compressing). */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits per channel, RGBA, deflate, no filter, no interlace
  const rows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

export const ICON_FILES: ReadonlyArray<{ path: string; size: number; rounded: boolean }> = [
  { path: "public/favicon-32.png", size: 32, rounded: true },
  { path: "public/apple-touch-icon.png", size: 180, rounded: false },
];

function main(): void {
  for (const { path, size, rounded } of ICON_FILES) {
    writeFileSync(path, encodePng(size, size, renderIcon(size, { rounded })));
    console.log(`Wrote ${path} (${size}×${size})`);
  }
}

// Run only when started as a script, not when the tests import this file.
const startedAsScript = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (startedAsScript) main();
