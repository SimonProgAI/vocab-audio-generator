const ILLEGAL_FILENAME_CHARS = /[/\\:*?"<>|]/g;
const CONTROL_CHARS = /\p{Cc}/gu;
const MAX_FILENAME_LENGTH = 100;

// Letters that Unicode normalization does not split into base letter + accent.
const LIGATURES: Readonly<Record<string, string>> = {
  œ: "oe",
  Œ: "OE",
  æ: "ae",
  Æ: "AE",
  ß: "ss",
};

/** Removes characters that are not allowed in filenames on Windows, macOS, or Linux. */
export function sanitizeFilename(name: string): string {
  return name
    .replace(ILLEGAL_FILENAME_CHARS, "")
    .replace(CONTROL_CHARS, "")
    .slice(0, MAX_FILENAME_LENGTH);
}

function stripAccents(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[œŒæÆß]/g, (char) => LIGATURES[char] ?? char);
}

/**
 * Turns speech text into a filename stem.
 * "une rivière" → "une_riviere", "ça va" → "ca_va", "l'œuf" → "l_oeuf".
 */
export function slugify(text: string): string {
  return sanitizeFilename(stripAccents(text).toLowerCase())
    .replace(/[^\p{L}\p{N}-]+/gu, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
}
