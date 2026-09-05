import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { DebugSession } from '../src/debug/session.js';
import type { DebugLauncher, DebugProcess } from '../src/debug/session.js';

/**
 * A launcher that spawns directly, standing in for the container.
 *
 * The session is written against the launcher interface precisely so that the
 * protocol can be tested without a jail; production goes through the container's
 * terminal, which carries the approval and audit the tests do not need.
 */
const directLauncher: DebugLauncher = {
  async launch(argv, cwd): Promise<DebugProcess> {
    const child = spawn(argv[0]!, [...argv.slice(1)], {
      ...(cwd ? { cwd } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
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
  'const values = [];',
  'for (let index = 0; index < 3; index += 1) {',
  '  const doubled = index * 2;',
  '  values.push(doubled);',
  '}',
  'console.log(values.join(","));',
  '',
].join('\n');

describe('DebugSession', () => {
  let root: string;
  let script: string;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-debug-'));
    script = path.join(root, 'loop.mjs');
    await fs.writeFile(script, PROGRAM);
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('stops where it was told to, reads the frame, and runs to the end', async () => {
    const session = new DebugSession(script);
    try {
      // Set before launching: the line worth stopping at is usually reached
      // before a caller could have attached to a running process.
      await session.setBreakpoint(script, 3);

      const start = await session.launch(directLauncher, [], root);
      assert.equal(start.frames.length > 0, true, JSON.stringify(start));

      const first = await session.resume();
      assert.equal(first.frames[0]?.line, 3, JSON.stringify(first));

      assert.equal(await session.inspect('index'), '0');
      assert.equal(await session.inspect('index * 10 + 1'), '1');

      const locals = await session.locals();
      assert.ok(locals.some((local) => local.name === 'index'));

      // One line forward, then round the loop again with a larger index.
      const stepped = await session.step('over');
      assert.equal(stepped.frames[0]?.line, 4, JSON.stringify(stepped));

      const second = await session.resume();
      assert.equal(second.frames[0]?.line, 3, JSON.stringify(second));
      assert.equal(await session.inspect('index'), '1');

      // Off the breakpoint and out: the program has to be allowed to finish, and
      // the tool has to notice that it did rather than waiting for a pause that
      // is never coming.
      let end = await session.resume();
      for (let round = 0; round < 4 && end.reason !== 'exited'; round += 1) {
        end = await session.resume();
      }
      assert.equal(end.reason, 'exited', JSON.stringify(end));
      assert.equal(session.exited, true);
    } finally {
      await session.stop();
    }
  });

  it('reports a program that never opens an inspector instead of hanging', async () => {
    const session = new DebugSession(path.join(root, 'missing.mjs'));
    try {
      await assert.rejects(
        session.launch(
          {
            async launch(): Promise<DebugProcess> {
              return {
                async output(): Promise<string> { return 'not an inspector line\n'; },
                async stop(): Promise<void> { /* nothing to stop */ },
              };
            },
          },
          [],
          root,
        ),
        /never opened an inspector/,
      );
    } finally {
      await session.stop();
    }
  });
});
