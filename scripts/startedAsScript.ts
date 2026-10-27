import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * True when the module at `moduleUrl` (pass `import.meta.url`) is the file `node` was started
 * with, false when a test imports it. Node gives the started file its real path, so a path
 * through a folder link or junction is resolved before comparing; otherwise the script would
 * exit without doing anything. (import.meta.main says the same, but only exists from Node 22.18
 * and 24.2.)
 */
export function startedAsScript(moduleUrl: string, scriptPath = process.argv[1]): boolean {
  if (scriptPath === undefined) return false;
  try {
    return pathToFileURL(realpathSync(scriptPath)).href === moduleUrl;
  } catch {
    return false; // The started file isn't on disk (e.g. `node -e`), so it isn't this module.
  }
}
