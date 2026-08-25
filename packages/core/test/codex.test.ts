import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

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
