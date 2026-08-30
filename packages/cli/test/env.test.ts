import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  findCommand,
  slashCommandPresentation,
} from '../src/commands.js';
import type { EnvCommandActions } from '../src/commands/env.js';
import type { CommandContext } from '../src/commands.js';

describe('/env dispatch and safe presentation', () => {
  const safeStatus = {
    sessionId: 'session-test',
    storage: 'encrypted' as const,
    variables: [{ name: 'API_KEY', loaded: true }],
  };

  function actions(calls: string[]): EnvCommandActions {
    return {
      status: async () => safeStatus,
      set: async (name, value) => {
        calls.push(`set:${name}:${value ?? 'prompt'}`);
        return { name, saved: true };
      },
      importFile: async () => ({ names: ['API_KEY'] }),
      delete: async (name) => { calls.push(`delete:${name}`); return true; },
      clear: async () => { calls.push('clear'); return 1; },
    };
  }

  it('opens the environment picker without producing a timeline entry', async () => {
    let opened = false;
    const result = await findCommand('env')!.run([], {
      hasPersistentSession: async () => true,
      env: actions([]),
      openEnv: () => { opened = true; },
    } as unknown as CommandContext);
    assert.equal(opened, true);
    assert.equal(result.entries.length, 0);
  });

  it('accepts an inline value through the seam while never rendering it', async () => {
    const calls: string[] = [];
    const result = await findCommand('env')!.run(['set', 'API_KEY', 'super-secret'], {
      hasPersistentSession: async () => true,
      env: actions(calls),
    } as unknown as CommandContext);
    const rendered = JSON.stringify(result.entries);
    assert.deepEqual(calls, ['set:API_KEY:super-secret']);
    assert.doesNotMatch(rendered, /super-secret/);
    assert.match(rendered, /API_KEY/);
  });

  it('explains the session limitation before touching secure storage', async () => {
    let touched = false;
    const result = await findCommand('env')!.run(['status'], {
      hasPersistentSession: async () => false,
      env: {
        ...actions([]),
        status: async () => { touched = true; return safeStatus; },
      },
    } as unknown as CommandContext);
    assert.equal(touched, false);
    assert.match(result.entries[0]?.title ?? '', /persistent session/);
  });

  it('removes env values from composer history/timeline presentation', () => {
    const presentation = slashCommandPresentation('/env set API_KEY super-secret');
    assert.equal(presentation.remember, false);
    assert.equal(presentation.timeline, true);
    assert.doesNotMatch(presentation.display, /super-secret/);
    assert.deepEqual(slashCommandPresentation('/btw what is this?'), {
      display: '',
      remember: false,
      timeline: false,
    });
  });
});
