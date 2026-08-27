#!/usr/bin/env node
/**
 * Make the optional `node-pty` native module usable on this machine.
 *
 * `plif web` prefers node-pty and falls back to the Python bridge when the
 * native binary is missing, so this script is never required — it only
 * upgrades the PTY path. Strategy, in order:
 *
 *   1. node-pty already loads         -> nothing to do.
 *   2. Local C toolchain (make+g++)   -> `npm rebuild node-pty`.
 *   3. Docker available               -> compile in a disposable
 *      node:<major>-bookworm container (older glibc, so the binary also runs
 *      on newer hosts) and drop it into
 *      node_modules/node-pty/prebuilds/<plat>-<arch>/, the directory the
 *      node-pty loader checks at runtime.
 *   4. Neither                        -> report; the Python bridge keeps
 *      `plif web` working.
 */
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localRequire = createRequire(import.meta.url);

const run = (command) => execSync(command, { cwd: root, stdio: 'inherit' });
const has = (command) =>
  spawnSync('sh', ['-c', `command -v ${command}`], { stdio: 'pipe' }).status === 0;

function nodePtyLoads() {
  try {
    return typeof localRequire('node-pty').spawn === 'function';
  } catch {
    return false;
  }
}

if (nodePtyLoads()) {
  console.log('build-pty: node-pty already usable — nothing to do.');
  process.exit(0);
}

if (os.platform() === 'win32') {
  console.log('build-pty: Windows ships node-pty prebuilds; run a plain `npm install`.');
  process.exit(0);
}

// Make sure the JS half of node-pty is present (optional deps can be skipped
// when their install script fails on toolchain-less machines).
run('npm install --ignore-scripts --no-audit --no-fund');

const packageDir = path.join(root, 'node_modules', 'node-pty');
if (!fs.existsSync(packageDir)) {
  console.log('build-pty: node-pty is not installed; cannot continue.');
  process.exit(1);
}
const prebuildDir = path.join(packageDir, 'prebuilds', `${os.platform()}-${os.arch()}`);

if (has('make') && (has('g++') || has('cc'))) {
  console.log('build-pty: compiling with the local toolchain…');
  // Newer npm gates install scripts behind an allowlist; best effort.
  spawnSync('npm', ['install-scripts', 'approve', 'node-pty'], { cwd: root, stdio: 'ignore' });
  try {
    run('npm rebuild node-pty');
  } catch {
    // Validated via nodePtyLoads() below.
  }
  if (nodePtyLoads()) {
    console.log('build-pty: node-pty compiled locally.');
    process.exit(0);
  }
}

if (has('docker')) {
  console.log('build-pty: compiling inside a disposable docker container…');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'plif-pty-'));
  const inner = [
    'set -e',
    'apt-get update -qq',
    'apt-get install -y -qq --no-install-recommends python3 make g++ >/dev/null',
    'mkdir /build && cd /build',
    'npm init -y >/dev/null',
    'npm install --no-audit --no-fund node-pty@^1.1.0 >/dev/null 2>&1 || true',
    'npm install-scripts approve node-pty >/dev/null 2>&1 || true',
    'npm rebuild node-pty >/dev/null',
    'cp node_modules/node-pty/build/Release/pty.node /out/pty.node',
  ].join(' && ');
  try {
    run(
      `docker run --rm -v ${JSON.stringify(out)}:/out node:${process.versions.major}-bookworm sh -c ${JSON.stringify(inner)}`,
    );
    fs.mkdirSync(prebuildDir, { recursive: true });
    fs.copyFileSync(path.join(out, 'pty.node'), path.join(prebuildDir, 'pty.node'));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
  if (nodePtyLoads()) {
    console.log('build-pty: prebuilt binary installed into', path.relative(root, prebuildDir));
    process.exit(0);
  }
}

console.log('build-pty: no usable build path found — plif web will keep using the Python bridge.');
