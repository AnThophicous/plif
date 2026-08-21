import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GlobalConfig } from '@plif/core';

import {
  configCategoryStarts,
  createConfigSettings,
  filterConfigSettings,
} from '../src/configuration.js';
import { configViewport } from '../src/components/ConfigScreen.js';
import { initialSession, sessionReducer } from '../src/session.js';

const config: GlobalConfig = {
  model: 'opencode/deepseek-v4-flash-free',
  theme: 'midnight',
  effort: 'high',
  permissionMode: 'ask',
  temperature: 0.2,
  timeoutMs: 90_000,
  apiKey: 'sk-this-must-never-be-rendered',
  providerKeys: { opencode: 'another-secret' },
};

function actions() {
  const calls: string[] = [];
  return {
    calls,
    setTheme: async (id: string) => { calls.push(`theme:${id}`); },
    setEffort: async (effort: string | undefined) => { calls.push(`effort:${effort ?? 'default'}`); },
    setPermissionMode: async (mode: 'ask' | 'auto-approve' | 'deny') => { calls.push(`permission:${mode}`); },
    updateGlobal: async (patch: Record<string, unknown>) => { calls.push(`patch:${String(Object.keys(patch)[0])}`); },
    openModels: async () => { calls.push('models'); },
    openProviders: async () => { calls.push('providers'); },
    openMcp: () => { calls.push('mcp'); },
    openSkills: () => { calls.push('skills'); },
  };
}

function settings() {
  const handlers = actions();
  const value = createConfigSettings({
    config,
    activeThemeId: 'midnight',
    themes: [
      { id: 'minimal', name: 'Minimal' },
      { id: 'midnight', name: 'MidNight', description: 'quiet' },
    ],
    provider: 'OpenCode',
    model: 'deepseek-v4-flash-free',
    effort: 'high',
    supportedEfforts: ['low', 'medium', 'high', 'plif'],
    mcpConnected: 1,
    mcpServers: 2,
    skills: 4,
    workspace: 'C:\\work\\plif',
  }, handlers);
  return { value, handlers };
}

describe('config registry', () => {
  it('is generated from real runtime fields and never exposes credentials', () => {
    const { value } = settings();
    const ids = value.map((setting) => setting.id);

    assert.ok(ids.includes('theme'));
    assert.ok(ids.includes('permissionMode'));
    assert.equal(value.find((setting) => setting.id === 'autoApprove')?.kind, 'boolean');
    assert.ok(ids.includes('model'));
    assert.ok(ids.includes('effort'));
    assert.doesNotMatch(JSON.stringify(value), /this-must-never-be-rendered|another-secret/);
    assert.deepEqual(configCategoryStarts(value).map((item) => item.category), [
      'Interface', 'Behavior', 'Runtime', 'Integrations', 'Storage',
    ]);
  });

  it('filters labels, descriptions, ids and aliases case-insensitively', () => {
    const { value } = settings();

    assert.deepEqual(filterConfigSettings(value, 'model id').map((setting) => setting.id), ['provider', 'model']);
    assert.deepEqual(filterConfigSettings(value, 'approval tools').map((setting) => setting.id), ['permissionMode', 'autoApprove']);
    assert.deepEqual(filterConfigSettings(value, 'does-not-exist'), []);
  });

  it('routes edits through the same domain actions used by the main commands', async () => {
    const { value, handlers } = settings();
    await value.find((setting) => setting.id === 'theme')!.apply!('minimal');
    await value.find((setting) => setting.id === 'effort')!.apply!('plif');
    await value.find((setting) => setting.id === 'permissionMode')!.apply!('deny');
    await value.find((setting) => setting.id === 'autoApprove')!.apply!('true');
    await value.find((setting) => setting.id === 'timeoutMs')!.apply!('120000');

    assert.deepEqual(handlers.calls, [
      'theme:minimal',
      'effort:plif',
      'permission:deny',
      'permission:auto-approve',
      'patch:timeoutMs',
    ]);
  });

  it('rejects invalid numeric values before persistence is called', async () => {
    const { value, handlers } = settings();
    await assert.rejects(value.find((setting) => setting.id === 'timeoutMs')!.apply!('1.5'), /integer/);
    await assert.rejects(value.find((setting) => setting.id === 'temperature')!.apply!('not-a-number'), /number/);
    assert.deepEqual(handlers.calls, []);
  });

  it('lets the optional output limit be cleared without writing undefined TOML', async () => {
    const { value, handlers } = settings();
    await value.find((setting) => setting.id === 'maxTokens')!.apply!('');
    assert.deepEqual(handlers.calls, ['patch:maxTokens']);
  });
});

describe('config screen reducer state', () => {
  it('keeps selected settings visible when category headings consume narrow rows', () => {
    const { value } = settings();
    const viewport = configViewport(value, 6, 8);

    assert.ok(viewport.start <= 6);
    assert.ok(viewport.end > 6);
    assert.ok(viewport.end - viewport.start < value.length);
  });

  it('opens, filters, edits and closes without touching the transcript state', () => {
    const opened = sessionReducer(initialSession, { type: 'screen.open', screen: 'config' });
    const filtered = sessionReducer(opened, { type: 'config.filter', filter: 'model' });
    const editing = sessionReducer(filtered, { type: 'config.edit.start', id: 'effort', value: 'high' });
    const changed = sessionReducer(editing, { type: 'config.edit.value', value: 'plif' });
    const closed = sessionReducer(changed, { type: 'screen.close' });

    assert.equal(opened.screen?.kind, 'config');
    assert.equal(filtered.screen?.kind === 'config' ? filtered.screen.state.filter : '', 'model');
    assert.equal(changed.screen?.kind === 'config' ? changed.screen.state.editing?.value : '', 'plif');
    assert.equal(closed.screen, null);
    assert.deepEqual(closed.entries, []);
    assert.deepEqual(closed.committed, []);
  });
});
