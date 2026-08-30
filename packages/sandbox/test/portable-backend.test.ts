import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import type { JailOptions, SpawnOptions } from '../src/backend.js';
import { PortableBackend } from '../src/portable/backend.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function options(root: string, argv: readonly string[], env: Readonly<Record<string, string>> = {}): SpawnOptions {
  return {
    argv,
    cwd: root,
    virtualCwd: '/',
    env,
    timeoutMs: 5_000,
    maxOutputBytes: 64 * 1024,
  };
}

describe('PortableBackend environment construction', () => {
  it('inherits safe process plumbing for command lookup without leaking arbitrary host variables', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-portable-env-'));
    roots.push(root);
    const hostOnly = 'PLIF_PORTABLE_HOST_SECRET';
    const previous = process.env[hostOnly];
    process.env[hostOnly] = 'host-secret-must-not-be-inherited';
    const backend = new PortableBackend();
    const jail = await backend.createJail({
      id: `portable-env-${path.basename(root)}`,
      root,
      memoryBytes: 64 * 1024 * 1024,
      maxProcesses: 4,
      cpuCores: 1,
      writablePaths: [root],
      allowNetwork: false,
      mounts: [],
    } satisfies JailOptions);

    try {
      // `node` must be found through the safely inherited PATH. The session
      // value is explicit input and is therefore allowed through.
      const result = await jail.spawn(options(root, [
        'node',
        '-e',
        "process.stdout.write(process.env.PLIF_PORTABLE_HOST_SECRET ? 'leaked' : (process.env.PLIF_SESSION_VALUE === 'ok' ? 'safe' : 'missing'))",
      ], { PLIF_SESSION_VALUE: 'ok' }));
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, 'safe');
    } finally {
      await jail.dispose();
      if (previous === undefined) delete process.env[hostOnly];
      else process.env[hostOnly] = previous;
    }
  });

  it('keeps a terminal alive for input, streamed output and a later exit', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-portable-terminal-'));
    roots.push(root);
    const backend = new PortableBackend();
    const jail = await backend.createJail({
      id: `portable-terminal-${path.basename(root)}`,
      root,
      memoryBytes: 64 * 1024 * 1024,
      maxProcesses: 4,
      cpuCores: 1,
      writablePaths: [root],
      allowNetwork: false,
      mounts: [],
    } satisfies JailOptions);
    const terminal = await jail.openTerminal({
      argv: [
        process.execPath,
        '-e',
        "process.stdin.setEncoding('utf8'); process.stdin.on('data', value => { process.stdout.write('echo:' + value); if (value.includes('quit')) process.exit(0); });",
      ],
      cwd: root,
      virtualCwd: '/',
      env: {},
      maxOutputBytes: 64 * 1024,
    });

    try {
      await terminal.write('hello\n');
      const deadline = Date.now() + 3_000;
      let output = '';
      while (Date.now() < deadline && !output.includes('echo:hello')) {
        output += (await terminal.readAvailable()).map((item) => item.chunk).join('');
        if (!output.includes('echo:hello')) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.match(output, /echo:hello/);
      await terminal.write('quit\n');
      const result = await terminal.wait();
      assert.equal(result.exitCode, 0, result.stderr);
    } finally {
      await terminal.close();
      await jail.dispose();
    }
  });
});
