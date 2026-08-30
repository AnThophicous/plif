import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { MemoryStore } from '../src/harness/memory.js';
import { remember } from '../src/harness/tools.js';
import { StorePaths } from '../src/store/paths.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('SQLite memory scopes', () => {
  it('combines global and exact workspace memory without crossing folders', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-memory-scopes-'));
    roots.push(root);
    const store = new MemoryStore(new StorePaths(root));
    const alpha = path.join(root, 'Alpha');
    const beta = path.join(root, 'Beta');

    await store.rememberGlobal({ kind: 'fact', text: 'Use English in the default interface.' });
    await store.remember({ workspace: alpha, kind: 'fact', text: 'Alpha uses pnpm.' });

    const alphaSnapshot = await store.snapshot(path.join(alpha, '.'));
    const betaSnapshot = await store.snapshot(beta);
    assert.equal(alphaSnapshot.facts.some((fact) => fact.text === 'Use English in the default interface.'), true);
    assert.equal(alphaSnapshot.facts.some((fact) => fact.text === 'Alpha uses pnpm.'), true);
    assert.equal(betaSnapshot.facts.some((fact) => fact.text === 'Use English in the default interface.'), true);
    assert.equal(betaSnapshot.facts.some((fact) => fact.text === 'Alpha uses pnpm.'), false);
    assert.equal((await store.facts(beta)).some((fact) => fact.text === 'Use English in the default interface.'), false);
  });

  it('keeps identical strategies isolated between workspaces', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-memory-strategies-'));
    roots.push(root);
    const store = new MemoryStore(new StorePaths(root));
    const alpha = path.join(root, 'Alpha');
    const beta = path.join(root, 'Beta');

    await store.recordOutcome({
      workspace: alpha,
      goal: 'run tests',
      approach: 'npm test',
      ok: true,
      context: { os: 'windows' },
      sessionId: 'alpha-session',
    });
    await store.recordOutcome({
      workspace: beta,
      goal: 'run tests',
      approach: 'npm test',
      ok: false,
      context: { os: 'linux' },
      sessionId: 'beta-session',
    });

    const alphaStrategies = await store.strategies(alpha);
    const betaStrategies = await store.strategies(beta);
    assert.equal(alphaStrategies.length, 1);
    assert.equal(betaStrategies.length, 1);
    assert.equal(alphaStrategies[0]?.outcomes[0]?.ok, true);
    assert.equal(betaStrategies[0]?.outcomes[0]?.ok, false);
    assert.notEqual(alphaStrategies[0]?.id, betaStrategies[0]?.id);
  });

  it('rejects child memory writes at the tool boundary and blocks credential-like facts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-memory-guard-'));
    roots.push(root);
    const store = new MemoryStore(new StorePaths(root));
    const workspace = path.join(root, 'workspace');
    const context = {
      memory: store,
      workspace,
      readOnlyMemory: true,
    } as never;

    const denied = await remember.run({ text: 'the child learned a fact' }, context);
    assert.equal(denied.ok, false);
    assert.match(denied.output, /read-only/);

    await assert.rejects(
      store.remember({ workspace, kind: 'fact', text: 'Use sk_1234567890abcdef in production.' }),
      /credentials cannot be stored in memory/,
    );
    await assert.rejects(
      store.remember({ workspace, kind: 'fact', text: 'Never put (sk_1234567890abcdef) in a note.' }),
      /credentials cannot be stored in memory/,
    );
    assert.deepEqual(await store.facts(workspace), []);
  });
});
