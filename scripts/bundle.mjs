/**
 * Bundle the terminal into one file, and put its assets beside it.
 *
 * The interactive entrypoint pulls in roughly 230 ESM modules across the
 * engine, the terminal and their dependencies. Node resolves and compiles each
 * of those separately, and on this repository that costs about 300ms before a
 * single frame is drawn — measured by importing the app module graph with and
 * without this bundle (~360ms against ~65ms). None of that time is doing
 * anything: it is filesystem round trips and per-module setup for code that
 * ends up in one process anyway.
 *
 * Four packages stay out of the bundle deliberately:
 *
 * - `openai`, `@anthropic-ai/sdk` and `@modelcontextprotocol/sdk` are imported
 *   dynamically at the point of first use precisely so a session that never
 *   touches them never pays for them. Inlining them would turn three lazy
 *   imports into eager ones and hand back more startup than the bundle saves.
 * - `koffi` and `@slate-terminal/native` load platform `.node` binaries, which
 *   are not JavaScript and cannot be inlined at all.
 *
 * The assets are copied rather than referenced because a bundle has one module
 * URL, so every asset path that used to be resolved relative to its own source
 * file now resolves relative to the bundle. `packages/core/src/assets.ts` looks
 * for a `plif-assets` directory beside the running module first; this script is
 * what puts one there.
 */

import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'packages/cli/dist/main.js');
const outputDirectory = path.join(root, 'packages/cli/dist');
const outputFile = path.join(outputDirectory, 'plif.mjs');
const assetsDirectory = path.join(outputDirectory, 'plif-assets');

/** Left out of the bundle: lazily imported SDKs and native addons. See the header. */
const EXTERNAL = [
  'openai',
  '@anthropic-ai/sdk',
  '@modelcontextprotocol/sdk',
  '@modelcontextprotocol/sdk/*',
  'koffi',
  '@slate-terminal/native',
  // sql.js ships a WebAssembly build it locates through its own `__dirname`
  // and `require.resolve("sql.js/dist/...")`. Inlined, both point at the
  // bundle instead of the package, and the wasm is never found.
  'sql.js',
  // undici is loaded only when a proxy is configured, and inlining it makes
  // that dynamic import eager: it cost ~150ms of startup on a machine with no
  // proxy at all, which is nearly every machine.
  'undici',
];

/**
 * Assets, as `plif-assets`-relative destination -> repository source.
 *
 * The destination names are the ones the call sites pass to `resolveAsset`, so
 * this table and those calls have to agree. They are listed here rather than
 * discovered because a missing asset should fail this build loudly, not
 * degrade a shipped bundle quietly.
 */
const ASSETS = [
  ['instructions', 'packages/core/src/agenting/instructions'],
  ['skills/builtin', 'packages/core/src/agenting/skills/builtin'],
  ['schema/config.schema.toml', 'packages/core/schema/config.schema.toml'],
  ['code-mode/runner.mjs', 'packages/core/src/harness/code-mode/runtime/runner.mjs'],
  ['cli/package.json', 'packages/cli/package.json'],
  ['negaopelao2.png', 'packages/cli/assets/negaopelao2.png'],
];

/**
 * Assets that legitimately may not be here.
 *
 * The updater binaries are produced by a separate release job, so a developer
 * build has none. A bundle without them behaves exactly as an unbundled
 * install without them does: `updaterFile()` finds nothing and the in-place
 * update path stays off.
 */
const OPTIONAL_ASSETS = [['updater', 'packages/cli/assets/updater']];

function copyAsset(destination, source, { optional = false } = {}) {
  const from = path.join(root, source);
  if (!existsSync(from)) {
    if (optional) return false;
    throw new Error(`bundle asset is missing: ${source}`);
  }
  const to = path.join(assetsDirectory, destination);
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { recursive: statSync(from).isDirectory() });
  return true;
}

async function main() {
  if (!existsSync(entry)) {
    throw new Error(`run "npm run build" first: ${path.relative(root, entry)} does not exist`);
  }

  rmSync(assetsDirectory, { recursive: true, force: true });
  mkdirSync(assetsDirectory, { recursive: true });

  const result = await build({
    entryPoints: [entry],
    outfile: outputFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    external: EXTERNAL,
    /**
     * Give the bundle a real `require`.
     *
     * Some dependencies are CommonJS and call `require("util")` at load time —
     * `vscode-jsonrpc`, under the LSP client, is the one that surfaces first.
     * esbuild's ESM output replaces those with a shim that throws unless a
     * `require` is already in scope, so the banner puts one there. Without it
     * the bundle fails on its first line of real work rather than at build
     * time, which is the wrong end to find out.
     */
    banner: {
      js: [
        "import { createRequire as __plifCreateRequire } from 'node:module';",
        'const require = __plifCreateRequire(import.meta.url);',
      ].join('\n'),
    },
    // Kept readable: the win here is one file instead of hundreds, not fewer
    // bytes, and a minified bundle turns every future stack trace from this
    // binary into a puzzle.
    minify: false,
    sourcemap: true,
    logLevel: 'warning',
    metafile: true,
  });

  for (const [destination, source] of ASSETS) copyAsset(destination, source);
  const skipped = OPTIONAL_ASSETS.filter(
    ([destination, source]) => !copyAsset(destination, source, { optional: true }),
  );

  const bytes = result.metafile.outputs[
    path.relative(process.cwd(), outputFile).split(path.sep).join('/')
  ]?.bytes;
  process.stdout.write(
    `bundled ${path.relative(root, outputFile)}` +
      (bytes ? ` (${(bytes / 1_000_000).toFixed(1)} MB)` : '') +
      `\nassets  ${path.relative(root, assetsDirectory)}` +
      (skipped.length > 0 ? ` (absent: ${skipped.map(([name]) => name).join(', ')})` : '') +
      '\n',
  );
}

await main();
