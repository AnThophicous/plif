import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import os from 'node:os';
import path from 'node:path';

import {
  CodexProvider,
  MODEL_CATALOG,
  createModelProvider,
  describe as describeModel,
  findCatalogProvider,
  resolveConfig,
  validateModelConfig,
} from '../src/index.js';
import { codexPermissionSettings } from '../src/model/codex.js';

async function fakeCodexCommand(root: string): Promise<string> {
  const fixture = fileURLToPath(new URL('./fixtures/fake-codex-app-server.mjs', import.meta.url));
  const command = path.join(root, process.platform === 'win32' ? 'fake-codex.cmd' : 'fake-codex');
  if (process.platform === 'win32') {
    await writeFile(command, `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`, 'utf8');
  } else {
    await writeFile(command, `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`, 'utf8');
    await chmod(command, 0o755);
  }
  return command;
}

describe('Codex / ChatGPT provider', () => {
  it('uses ChatGPT auth mode and never treats an OpenAI API key as Codex credentials', () => {
    const config = resolveConfig({
      preset: 'codex',
      model: 'codex/codex-default',
      apiKey: 'this-must-not-be-used',
    }, {
      env: {
        OPENAI_API_KEY: 'another-key-that-must-not-be-used',
        PLIF_API_KEY: 'a-generic-key-that-must-not-be-used',
      },
    });

    assert.equal(config.providerId, 'codex');
    assert.equal(config.authMode, 'codex');
    assert.equal(config.apiKey, '');
    assert.equal(config.needKey, false);
    assert.deepEqual(validateModelConfig(config), { ok: true });
    assert.equal(describeModel(config).key, '(ChatGPT session via PLIF)');
  });

  it('keeps Codex distinct from the OpenAI API-key provider in the catalog', () => {
    const codex = findCatalogProvider('codex');
    const openai = findCatalogProvider('openai');
    assert.ok(codex);
    assert.ok(openai);
    assert.equal(codex.auth, 'codex');
    assert.match(codex.description, /PLIF sign-in window/i);
    assert.equal(openai.auth, undefined);
    assert.equal(codex.models[0]?.id, 'codex-default');
    assert.equal(MODEL_CATALOG.filter((provider) => provider.id === 'codex').length, 1);
  });

  it('selects the Codex adapter without making a process or network request', () => {
    const config = resolveConfig({ preset: 'codex', model: 'codex/codex-default' }, { env: {} });
    const provider = createModelProvider(config);
    assert.ok(provider instanceof CodexProvider);
    assert.equal(provider.info.providerId, 'codex');
    assert.equal(provider.info.endpoint, 'codex://app-server');
  });

  it('advertises the experimental app-server capability required by model discovery', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'plif-codex-capabilities-'));
    try {
      const config = resolveConfig({ preset: 'codex', model: 'codex/codex-default' }, { env: {} });
      const provider = new CodexProvider(config, { command: await fakeCodexCommand(root) });
      const result = await provider.listModels();
      assert.equal(result.supported, true);
      assert.deepEqual(result.models.map((model) => model.id), ['codex-default']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('sends the fast service tier only when Codex FAST is enabled', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'plif-codex-fast-'));
    const capturePath = path.join(root, 'turn.json');
    const previousCapture = process.env['PLIF_CODEX_CAPTURE'];
    process.env['PLIF_CODEX_CAPTURE'] = capturePath;
    try {
      const config = resolveConfig({
        preset: 'codex',
        model: 'codex/codex-default',
        codexFast: true,
      }, { env: {} });
      const provider = new CodexProvider(config, { command: await fakeCodexCommand(root) });
      const events = [];
      for await (const event of provider.stream({ messages: [{ role: 'user', content: 'hello' }] })) {
        events.push(event);
      }
      const turnRequest = JSON.parse(await readFile(capturePath, 'utf8'));
      assert.equal(turnRequest.method, 'turn/start');
      assert.equal(turnRequest.params.serviceTier, 'priority');
      assert.deepEqual(events, [
        { kind: 'text', delta: 'ok' },
        { kind: 'done', reason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } },
      ]);
    } finally {
      if (previousCapture === undefined) delete process.env['PLIF_CODEX_CAPTURE'];
      else process.env['PLIF_CODEX_CAPTURE'] = previousCapture;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not send a service tier when Codex FAST is disabled', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'plif-codex-standard-'));
    const capturePath = path.join(root, 'turn.json');
    const previousCapture = process.env['PLIF_CODEX_CAPTURE'];
    process.env['PLIF_CODEX_CAPTURE'] = capturePath;
    try {
      const config = resolveConfig({
        preset: 'codex',
        model: 'codex/codex-default',
        codexFast: false,
      }, { env: {} });
      const provider = new CodexProvider(config, { command: await fakeCodexCommand(root) });
      for await (const _event of provider.stream({ messages: [{ role: 'user', content: 'hello' }] })) {
        // Drain the stream so the app-server request and cleanup complete.
      }
      const turnRequest = JSON.parse(await readFile(capturePath, 'utf8'));
      assert.equal('serviceTier' in turnRequest.params, false);
    } finally {
      if (previousCapture === undefined) delete process.env['PLIF_CODEX_CAPTURE'];
      else process.env['PLIF_CODEX_CAPTURE'] = previousCapture;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('passes the PLIF workspace and permission policy to the native Codex app-server', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'plif-codex-workspace-'));
    const threadCapturePath = path.join(root, 'thread.json');
    const turnCapturePath = path.join(root, 'turn.json');
    const previousThreadCapture = process.env['PLIF_CODEX_THREAD_CAPTURE'];
    const previousTurnCapture = process.env['PLIF_CODEX_CAPTURE'];
    process.env['PLIF_CODEX_THREAD_CAPTURE'] = threadCapturePath;
    process.env['PLIF_CODEX_CAPTURE'] = turnCapturePath;
    try {
      const config = resolveConfig({ preset: 'codex', model: 'codex/codex-default' }, { env: {} });
      const provider = new CodexProvider(config, { command: await fakeCodexCommand(root) });
      for await (const _event of provider.stream({
        messages: [{ role: 'user', content: 'write inside the workspace' }],
        execution: {
          cwd: root,
          workspaceRoots: [root],
          permissionMode: 'ask',
        },
      })) {
        // Drain the stream so both app-server requests and cleanup complete.
      }

      const threadRequest = JSON.parse(await readFile(threadCapturePath, 'utf8'));
      const turnRequest = JSON.parse(await readFile(turnCapturePath, 'utf8'));
      assert.equal(threadRequest.params.cwd, root);
      assert.deepEqual(threadRequest.params.runtimeWorkspaceRoots, [root]);
      assert.equal(threadRequest.params.approvalPolicy, 'on-request');
      assert.equal(threadRequest.params.sandbox, 'workspace-write');
      assert.deepEqual(turnRequest.params.runtimeWorkspaceRoots, [root]);
      assert.equal(turnRequest.params.approvalPolicy, 'on-request');
      assert.deepEqual(turnRequest.params.sandboxPolicy, {
        type: 'workspaceWrite',
        writableRoots: [root],
      });
    } finally {
      if (previousThreadCapture === undefined) delete process.env['PLIF_CODEX_THREAD_CAPTURE'];
      else process.env['PLIF_CODEX_THREAD_CAPTURE'] = previousThreadCapture;
      if (previousTurnCapture === undefined) delete process.env['PLIF_CODEX_CAPTURE'];
      else process.env['PLIF_CODEX_CAPTURE'] = previousTurnCapture;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preloads mandatory PLIF skills into native Codex developer instructions', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'plif-codex-skills-'));
    const capturePath = path.join(root, 'thread.json');
    const previousCapture = process.env['PLIF_CODEX_THREAD_CAPTURE'];
    process.env['PLIF_CODEX_THREAD_CAPTURE'] = capturePath;
    try {
      const config = resolveConfig({ preset: 'codex', model: 'codex/codex-default' }, { env: {} });
      const provider = new CodexProvider(config, { command: await fakeCodexCommand(root) });
      for await (const _event of provider.stream({
        messages: [{ role: 'user', content: 'can you use skills?' }],
        preloadedSkills: [
          { name: 'anti-ai-slop', instructions: 'Keep user-visible output clean and free of emoji.' },
          { name: 'galileu', instructions: 'Review material decisions before acting.' },
          { name: 'plif-cybersecurity', instructions: 'Review security boundaries before changing code.' },
        ],
      })) {
        // Drain the stream so the thread request and cleanup complete.
      }
      const threadRequest = JSON.parse(await readFile(capturePath, 'utf8'));
      assert.match(threadRequest.params.developerInstructions, /PLIF SKILL BRIDGE/);
      assert.match(threadRequest.params.developerInstructions, /# Skill: anti-ai-slop/);
      assert.match(threadRequest.params.developerInstructions, /Keep user-visible output clean and free of emoji/);
      assert.match(threadRequest.params.developerInstructions, /# Skill: galileu/);
      assert.match(threadRequest.params.developerInstructions, /Review material decisions before acting/);
      assert.match(threadRequest.params.developerInstructions, /# Skill: plif-cybersecurity/);
      assert.match(threadRequest.params.developerInstructions, /never write or emit emoji/i);
      assert.match(threadRequest.params.developerInstructions, /clean and scan-friendly/i);
    } finally {
      if (previousCapture === undefined) delete process.env['PLIF_CODEX_THREAD_CAPTURE'];
      else process.env['PLIF_CODEX_THREAD_CAPTURE'] = previousCapture;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('projects app-server reasoning and tool items without turning them into local tool calls', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'plif-codex-activity-'));
    const previousActivity = process.env['PLIF_CODEX_ACTIVITY'];
    process.env['PLIF_CODEX_ACTIVITY'] = '1';
    try {
      const config = resolveConfig({ preset: 'codex', model: 'codex/codex-default' }, { env: {} });
      const provider = new CodexProvider(config, { command: await fakeCodexCommand(root) });
      const events = [];
      for await (const event of provider.stream({ messages: [{ role: 'user', content: 'run tests' }] })) events.push(event);
      assert.equal(events[0]?.kind, 'tool_activity');
      assert.deepEqual(events[0]?.kind === 'tool_activity' ? events[0].activity : null, {
        id: 'cmd-1',
        name: 'run_command',
        phase: 'start',
        input: { argv: ['npm test'], cwd: '/workspace' },
      });
      assert.equal(events[1]?.kind, 'tool_activity');
      assert.equal(events[1]?.kind === 'tool_activity' ? events[1].activity.output : null, 'passed\n');
      assert.equal(events[1]?.kind === 'tool_activity' ? events[1].activity.ok : null, true);
      assert.equal(events[2]?.kind, 'reasoning');
      assert.equal(events[3]?.kind, 'text');
      assert.equal(events[4]?.kind, 'done');
    } finally {
      if (previousActivity === undefined) delete process.env['PLIF_CODEX_ACTIVITY'];
      else process.env['PLIF_CODEX_ACTIVITY'] = previousActivity;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('turns a missing Codex CLI into an actionable login message', async () => {
    const config = resolveConfig({ preset: 'codex', model: 'codex/codex-default' }, { env: {} });
    const provider = new CodexProvider(config, { command: '__plif_codex_cli_missing__' });
    const result = await provider.probe();
    assert.equal(result.ok, false);
    assert.match(result.detail, /install Codex|select the provider in PLIF/i);
  });

  it('maps PLIF permission modes to a workspace-scoped Codex policy', () => {
    const auto = codexPermissionSettings({
      cwd: 'C:/workspace/plif',
      workspaceRoots: ['C:/workspace/plif'],
      permissionMode: 'auto-approve',
    });
    assert.equal(auto.thread.approvalPolicy, 'never');
    assert.equal(auto.thread.sandbox, 'workspace-write');
    assert.deepEqual(auto.turn.sandboxPolicy, {
      type: 'workspaceWrite',
      writableRoots: auto.roots,
    });

    const ask = codexPermissionSettings({
      cwd: 'C:/workspace/plif',
      workspaceRoots: ['C:/workspace/plif'],
      permissionMode: 'ask',
    });
    assert.equal(ask.thread.approvalPolicy, 'on-request');
    assert.equal(ask.turn.approvalPolicy, 'on-request');

    const failClosed = codexPermissionSettings({ permissionMode: 'auto-approve' });
    assert.equal(failClosed.thread.sandbox, 'read-only');
    assert.deepEqual(failClosed.turn.sandboxPolicy, { type: 'readOnly' });
  });
});
