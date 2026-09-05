/**
 * Where plif's shipped, non-code assets live.
 *
 * Seven places in the engine and the terminal need a file that is not
 * JavaScript: the agent instruction markdown, the builtin skill packages, the
 * config schema, the code-mode runner, the CLI's own package.json, the updater
 * binaries and the header mascot. Each of them used to answer the question the
 * same way — walk up from `import.meta.url` and try two relative paths, one for
 * a built `dist` tree and one for a source checkout.
 *
 * That works exactly as long as every module keeps its own file. It stops the
 * moment the engine and the terminal are bundled into one file, because then
 * `import.meta.url` is the bundle's path and every relative candidate points
 * somewhere that does not exist — and the failure is not a missing asset but a
 * refusal to start, which is the worst way to find out.
 *
 * So the question gets one answer instead of seven. A bundled build copies its
 * assets into a `plif-assets` directory beside the bundle, and this module
 * looks there first. Nothing else changes: each caller still passes the
 * relative candidates it always used, and an unbundled run finds them exactly
 * where it did before. The bundle candidate simply is not there to be found.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The directory a bundled build copies its assets into.
 *
 * A single name, rather than a per-caller layout, so the bundle script has one
 * thing to produce and this file has one thing to look for.
 */
export const BUNDLED_ASSET_DIRECTORY = 'plif-assets';

/**
 * Resolve a shipped asset, preferring a bundled copy.
 *
 * `bundledName` is the asset's path under `plif-assets`. `candidates` are the
 * paths the caller would otherwise have tried, in its own order, already
 * absolute. The first path that exists wins; when none does the caller is told
 * so by getting `null` back, because the seven callers disagree about what a
 * missing asset means — some throw, some degrade — and that judgement is not
 * this module's to make.
 */
export function resolveAsset(
  moduleUrl: string,
  bundledName: string,
  candidates: readonly string[],
): string | null {
  const moduleDirectory = path.dirname(fileURLToPath(moduleUrl));
  const bundled = path.join(moduleDirectory, BUNDLED_ASSET_DIRECTORY, bundledName);
  for (const candidate of [bundled, ...candidates]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** The directory a module lives in, which most callers need to build their candidates. */
export function moduleDirectory(moduleUrl: string): string {
  return path.dirname(fileURLToPath(moduleUrl));
}
