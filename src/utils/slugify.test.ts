import { describe, expect, it } from "vitest";
import { sanitizeFilename, slugify } from "./slugify";

describe("slugify", () => {
  it.each([
    ["une rivière", "une_riviere"],
    ["ça va", "ca_va"],
    ["l'œuf", "l_oeuf"],
    ["Œuvre", "oeuvre"],
    ["c'est-à-dire", "c_est-a-dire"],
    ["Leçon 12", "lecon_12"],
    ["  le  café  ", "le_cafe"],
    ["Bonjour !", "bonjour"],
    ["-bonjour-", "bonjour"],
  ])("%j → %j", (text, expected) => {
    expect(slugify(text)).toBe(expected);
  });

  it("removes characters that are illegal in filenames instead of replacing them", () => {
    expect(slugify('oui/non\\a:b*c?d"e<f>g|h')).toBe("ouinonabcdefgh");
  });

  it("returns an empty string when nothing usable is left", () => {
    expect(slugify("?!")).toBe("");
  });

  it("caps the length at 100 characters", () => {
    expect(slugify("a".repeat(150))).toHaveLength(100);
  });
});

describe("sanitizeFilename", () => {
  it("keeps case, spaces and accents but drops illegal and control characters", () => {
    expect(sanitizeFilename('Une "rivière"?\t')).toBe("Une rivière");
  });

  it("caps the length at 100 characters", () => {
    expect(sanitizeFilename("é".repeat(150))).toHaveLength(100);
  });
});
