import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { DapSession, vendoredPythonPath } from '../src/debug/dap.js';
import type { DebugLauncher, DebugProcess } from '../src/debug/session.js';

/**
 * Python is not a build dependency of this repository, only a runtime one for
 * the language it debugs. Skipping beats failing on a machine that never had it.
 */
const hasPython = spawnSync('python', ['--version'], { stdio: 'ignore' }).status === 0;

const directLauncher: DebugLauncher = {
  async launch(argv, cwd, _reason, env): Promise<DebugProcess> {
    const child = spawn(argv[0]!, [...argv.slice(1)], {
      ...(cwd ? { cwd } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(env ?? {}) },
    });

    let buffered = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { buffered += chunk; });
    child.stderr.on('data', (chunk: string) => { buffered += chunk; });

    return {
      async output(): Promise<string> {
        const seen = buffered;
        buffered = '';
        return seen;
      },
      async stop(): Promise<void> {
        child.kill('SIGKILL');
      },
    };
  },
};

const PROGRAM = [
  'def add(a, b):',
  '    total = a + b',
  '    return total',
  '',
  'print(add(2, 40))',
  '',
].join('\n');

describe('DapSession', () => {
  let root: string;
  let script: string;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-dap-'));
    script = path.join(root, 'sum.py');
    await fs.writeFile(script, PROGRAM);
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('ships its own debugpy rather than relying on the machine having one', async () => {
    const vendored = vendoredPythonPath();
    const found = await fs.stat(path.join(vendored, 'debugpy')).catch(() => null);
    assert.ok(found?.isDirectory(), `no vendored debugpy under ${vendored}`);
  });

  it('debugs a Python program through the vendored adapter', { skip: !hasPython }, async () => {
    const session = new DapSession(script);
    try {
      await session.setBreakpoint(script, 2);

      const stopped = await session.launch(directLauncher, [], root);
      assert.equal(stopped.reason, 'breakpoint', JSON.stringify(stopped));
      assert.equal(stopped.frames[0]?.line, 2, JSON.stringify(stopped));
      assert.equal(stopped.frames[0]?.name, 'add');

      assert.equal(await session.inspect('a + b'), '42');

      // debugpy lists two collapsible group headings beside the real names; in a
      // flat list they read as locals with no value, so they must not survive.
      const locals = await session.locals();
      assert.deepEqual(
        locals.map((local) => local.name).sort(),
        ['a', 'b'],
        JSON.stringify(locals),
      );

      const stepped = await session.step('over');
      assert.equal(stepped.frames[0]?.line, 3, JSON.stringify(stepped));

      // The program's own print arrives over the protocol, not its pipe: without
      // redirectOutput the run would look like it produced nothing.
      const end = await session.resume();
      assert.equal(end.reason, 'exited', JSON.stringify(end));
      assert.match(end.output, /42/);
    } finally {
      await session.stop();
    }
  });
});
