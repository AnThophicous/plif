import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  defaultTokenSplitConfig,
  normalizeTokenSplitConfig,
  projectTokenSplitInput,
  runTokenSplitSanity,
  spillToolOutput,
  stateNotesHasHardFacts,
  stateNotesPath,
  tokenSplitDefinitions,
  writeStateNotes,
} from '../src/index.js';

test('token split keeps the raw message array unchanged and shortens only the request projection', () => {
  const config = defaultTokenSplitConfig();
  const source = [
    { role: 'user' as const, content: 'objective: keep packages/core/src/example.ts and ERR_SYNTHETIC' },
    { role: 'tool' as const, toolCallId: 'call-old', content: 'large tool output ' + 'x'.repeat(10000) },
    { role: 'assistant' as const, content: 'a'.repeat(2000) },
    { role: 'user' as const, content: 'next' },
    { role: 'assistant' as const, content: 'recent' },
    { role: 'user' as const, content: 'last' },
    { role: 'assistant' as const, content: 'latest' },
  ];
  const original = source.map((message) => ({ ...message }));
  const projection = projectTokenSplitInput(source, config);

  assert.deepEqual(source, original);
  assert.ok(projection.effectiveTokens < projection.baselineTokens);
  assert.ok(projection.transformations.some((item) => item.technique === 'tool-clear'));
  assert.match(projection.messages[0]!.content, /ERR_SYNTHETIC/);
  assert.match(projection.messages[1]!.content, /raw transcript retained/);
});

test('token split normalization restores missing technique safety defaults', () => {
  const config = normalizeTokenSplitConfig({ enabled: false, techniques: { compaction: { on: true } } });
  assert.equal(config.enabled, false);
  assert.equal(config.techniques.budgets.on, true);
  assert.equal(config.techniques.compaction.on, true);
  assert.equal(config.techniques.caveman.on, false);
  assert.equal(tokenSplitDefinitions().length, 14);
});

test('token split sanity reports safe projection checks and explicit non-wired techniques', () => {
  const results = runTokenSplitSanity();
  assert.equal(results.length, 14);
  assert.equal(results.find((result) => result.technique === 'tool-clear')?.status, 'pass');
  assert.equal(results.find((result) => result.technique === 'terse')?.status, 'not-wired');
  assert.equal(results.some((result) => result.status === 'fail'), false);
});

test('token split artifacts are redacted, auditable, and stored outside the model inline payload', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-token-split-'));
  try {
    const messages = [
      { role: 'user' as const, content: 'objective: inspect packages/core/src/example.ts' },
      { role: 'assistant' as const, content: 'decision: preserve the raw transcript' },
      { role: 'tool' as const, toolCallId: 'call-1', content: 'error: failed once' },
    ];
    await writeStateNotes(workspace, 'session/one', messages, 2);
    assert.equal(await stateNotesHasHardFacts(workspace, 'session/one'), true);
    assert.equal(await fs.stat(stateNotesPath(workspace, 'session/one')).then(() => true), true);

    const spilled = await spillToolOutput(workspace, 'session/one', 'call/1', 'safe output '.repeat(5000), {
      maxInlineChars: 100,
      headChars: 20,
      tailChars: 10,
      dir: '.plif/tmp/spill',
    });
    assert.ok(spilled);
    assert.match(spilled.content, /sha256:/);
    assert.match(spilled.content, /file: \.plif[\\/]tmp[\\/]spill/);
    assert.equal(spilled.bytes > spilled.content.length, true);
    assert.equal(await fs.stat(path.join(workspace, spilled.path)).then(() => true), true);

    const secret = await spillToolOutput(workspace, 'session/one', 'call-secret', 'api_key=sk-secret-value ' + 'x'.repeat(500), {
      maxInlineChars: 100,
      headChars: 20,
      tailChars: 10,
      dir: '.plif/tmp/spill',
    });
    assert.equal(secret, null);
    const escaped = await spillToolOutput(workspace, 'session/one', 'call-escape', 'safe output '.repeat(5000), {
      maxInlineChars: 100,
      headChars: 20,
      tailChars: 10,
      dir: '..\\outside',
    });
    assert.equal(escaped, null);
    const notes = await fs.readFile(stateNotesPath(workspace, 'session/one'), 'utf8');
    assert.doesNotMatch(notes, /sk-secret-value/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
