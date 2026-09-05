/**
 * The read-only reports, as menus.
 *
 * These used to print one blob each, in a layout each of them invented. They
 * now go through one shared picker, so what these tests hold is mostly
 * consistency: same shape, same navigation, and every view reachable without
 * knowing a flag or a subcommand existed.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findCommand } from '../src/commands.js';
import type { CommandContext } from '../src/commands.js';
import type { TimelineEntry } from '../src/session.js';

interface OpenedPicker {
  readonly title: string;
  readonly hint?: string;
  readonly countLabel?: string;
  readonly items: readonly { value: string; label: string; detail?: string; current?: boolean }[];
  readonly onPick: (value: string) => void;
}

function harness(overrides: Record<string, unknown> = {}) {
  const opened: OpenedPicker[] = [];
  const notices: TimelineEntry[] = [];
  const context = {
    cwd: 'C:/project',
    openPicker: (request: unknown) => {
      if (request && typeof request === 'object' && 'items' in request) {
        opened.push(request as OpenedPicker);
      }
    },
    notify: (item: TimelineEntry) => notices.push(item),
    ...overrides,
  } as unknown as CommandContext;
  return { context, opened, notices };
}

/** Wait for the promise a picked view kicks off. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('/audit', () => {
  const engine = {
    audit: {
      flush: async () => undefined,
      read: async function* () {
        yield { at: '2026-09-04T10:11:12Z', type: 'exec.start', data: { argv: ['ls'] } };
      },
      verify: async () => ({ ok: true }),
    },
  };

  it('offers the views instead of requiring a flag nobody knows', async () => {
    const { context, opened } = harness({ engine });
    await findCommand('audit')!.run([], context);

    assert.equal(opened.length, 1);
    assert.deepEqual(opened[0]!.items.map((item) => item.value), ['recent', 'verify']);
  });

  it('starts the cursor on the view people actually want', async () => {
    const { context, opened } = harness({ engine });
    await findCommand('audit')!.run([], context);
    assert.equal(opened[0]!.items[0]?.current, true);
  });

  it('keeps --verify working for anyone who already learned it', async () => {
    const { context, opened } = harness({ engine });
    const result = await findCommand('audit')!.run(['--verify'], context);

    assert.equal(opened.length, 0, 'the flag must not detour through a menu');
    assert.match(result.entries[0]?.title ?? '', /intact/);
  });

  it('runs the picked view and reports it through the notice channel', async () => {
    // The picker has closed by the time the view finishes, so its output
    // cannot be a return value.
    const { context, opened, notices } = harness({ engine });
    await findCommand('audit')!.run([], context);
    opened[0]!.onPick('verify');
    await settle();

    assert.equal(notices.length, 1);
    assert.match(notices[0]?.title ?? '', /intact/);
  });

  it('rejects an argument it does not understand', async () => {
    const { context } = harness({ engine });
    await assert.rejects(() => findCommand('audit')!.run(['--nope'], context));
  });
});

describe('/policy', () => {
  const engine = {
    policy: {
      document: {
        trust: 'developer',
        fallback: 'deny',
        networkAllowlist: ['registry.npmjs.org'],
        rules: [
          { decision: 'deny', name: 'vcs-protection', match: '/**/.git/**' },
          { decision: 'ask', name: 'host-writes', match: '/**' },
          { decision: 'allow', name: 'reads', match: '/**' },
        ],
      },
    },
  };

  it('splits the rules by what they do, which is how they are read', async () => {
    const { context, opened } = harness({ engine });
    await findCommand('policy')!.run([], context);

    assert.deepEqual(opened[0]!.items.map((item) => item.value), ['all', 'deny', 'ask', 'network']);
    assert.match(opened[0]!.title, /trust=developer/);
  });

  it('counts what each view holds, so the row is worth reading', async () => {
    const { context, opened } = harness({ engine });
    await findCommand('policy')!.run([], context);

    assert.match(opened[0]!.items[1]?.detail ?? '', /1 rule/);
    assert.match(opened[0]!.items[3]?.detail ?? '', /1 host/);
  });

  it('says plainly when nothing is reachable', async () => {
    const bare = { policy: { document: { ...engine.policy.document, networkAllowlist: [] } } };
    const { context, opened } = harness({ engine: bare });
    await findCommand('policy')!.run([], context);
    assert.match(opened[0]!.items[3]?.detail ?? '', /Empty/);
  });
});

describe('/memory', () => {
  const snapshot = {
    facts: [{ text: 'the build uses tsc', confirmations: 2, at: '', source: 'x' }],
    failures: [{ text: 'npm ci fails offline', confirmations: 1, at: '', source: 'x' }],
    strategies: [{ approach: 'read the config first', outcome: 'worked' }],
    notes: 'one\ntwo',
  };
  const engine = {
    memory: {
      snapshot: async () => snapshot,
      forget: async () => undefined,
    },
  };

  it('makes forgetting a row rather than a subcommand you had to know', async () => {
    const { context, opened } = harness({ engine });
    await findCommand('memory')!.run([], context);

    const values = opened[0]!.items.map((item) => item.value);
    assert.deepEqual(values, ['facts', 'failures', 'strategies', 'notes', 'forget']);
  });

  it('still forgets from the command line', async () => {
    const { context, opened } = harness({ engine });
    const result = await findCommand('memory')!.run(['forget'], context);
    assert.equal(opened.length, 0);
    assert.match(result.entries[0]?.title ?? '', /gone/);
  });

  it('does not open an empty menu when nothing is remembered', async () => {
    const bare = { memory: { snapshot: async () => ({ facts: [], failures: [], strategies: [], notes: '' }) } };
    const { context, opened } = harness({ engine: bare });
    const result = await findCommand('memory')!.run([], context);

    assert.equal(opened.length, 0);
    assert.match(result.entries[0]?.title ?? '', /nothing remembered/);
  });
});

describe('/images', () => {
  it('offers one row per image, with what the table used to print', async () => {
    const engine = {
      images: {
        list: async () => [
          { reference: 'plif/base:0.1', digest: 'sha256:abcdef012345', layers: ['a', 'b'] },
        ],
      },
    };
    const { context, opened } = harness({ engine });
    await findCommand('images')!.run([], context);

    assert.equal(opened.length, 1);
    assert.equal(opened[0]!.items[0]?.label, 'plif/base:0.1');
    assert.match(opened[0]!.items[0]?.detail ?? '', /2 layers/);
  });

  it('says so plainly when the store is empty', async () => {
    const { context, opened } = harness({ engine: { images: { list: async () => [] } } });
    const result = await findCommand('images')!.run([], context);

    assert.equal(opened.length, 0);
    assert.match(result.entries[0]?.title ?? '', /No images/);
  });
});

describe('/help', () => {
  it('offers every command as a row instead of a wall of text', async () => {
    const { context, opened } = harness();
    const result = await findCommand('help')!.run([], context);

    assert.equal(result.entries.length, 0, 'the menu is the output');
    assert.equal(opened.length, 1);
    assert.ok(opened[0]!.items.length > 30, 'every command should be listed');
    assert.ok(opened[0]!.items.some((item) => item.label === '/usage'));
  });

  it('lets a command be found by an alias, which is how people know some of them', async () => {
    const { context, opened } = harness();
    await findCommand('help')!.run([], context);
    const models = opened[0]!.items.find((item) => item.label === '/models') as
      | { searchText?: string }
      | undefined;

    assert.match(models?.searchText ?? '', /\bmodel\b/);
  });

  it('keeps the printed list behind --list, for copying a name out', async () => {
    const { context, opened } = harness();
    const result = await findCommand('help')!.run(['--list'], context);

    assert.equal(opened.length, 0);
    assert.match(result.entries[0]?.detail ?? '', /\/usage/);
  });

  it('rejects an argument it does not understand', async () => {
    const { context } = harness();
    await assert.rejects(() => findCommand('help')!.run(['nonsense'], context));
  });
});

describe('/plan', () => {
  it('says which state is active instead of silently toggling', async () => {
    const { context, opened } = harness({ setPlanMode: async () => undefined, planMode: true });
    await findCommand('plan')!.run([], context);

    assert.match(opened[0]!.title, /on/);
    assert.equal(opened[0]!.items[0]?.current, true, 'the cursor starts on the active state');
  });

  it('starts on "enter" when plan mode is off', async () => {
    const { context, opened } = harness({ setPlanMode: async () => undefined, planMode: false });
    await findCommand('plan')!.run([], context);
    assert.equal(opened[0]!.items[1]?.current, true);
  });

  it('sends a description straight through, because that is a request not a mode', async () => {
    const calls: Array<[boolean, string | undefined]> = [];
    const { context, opened } = harness({
      setPlanMode: async (on: boolean, description?: string) => { calls.push([on, description]); },
      planMode: false,
    });
    await findCommand('plan')!.run(['refactor', 'the', 'loader'], context);

    assert.equal(opened.length, 0);
    assert.deepEqual(calls, [[true, 'refactor the loader']]);
  });

  it('still leaves plan mode from the command line', async () => {
    const calls: Array<[boolean, string | undefined]> = [];
    const { context } = harness({
      setPlanMode: async (on: boolean, description?: string) => { calls.push([on, description]); },
      planMode: true,
    });
    await findCommand('plan')!.run(['off'], context);
    assert.deepEqual(calls, [[false, undefined]]);
  });
});

describe('commands that need typed text', () => {
  /** A context whose question surface answers with a queue of replies. */
  function asking(answers: readonly (string | null)[], overrides: Record<string, unknown> = {}) {
    const asked: string[] = [];
    const queue = [...answers];
    const { engine: engineOverride, ...rest } = overrides;
    return {
      asked,
      ...harness({
        ...rest,
        // The question surface has to survive the engine override, so it is
        // merged in rather than spread over.
        engine: {
          questions: {
            ask: async (question: { text: string }) => {
              asked.push(question.text);
              return queue.shift() ?? null;
            },
          },
          ...(engineOverride as Record<string, unknown> ?? {}),
        },
      }),
    };
  }

  it('/build asks for the reference and the directory instead of refusing', async () => {
    const built: Array<{ reference: string; source: string }> = [];
    const { context, asked } = asking(['myproject/base:1.0', 'src'], {
      cwd: 'C:/project',
      engine: { buildImage: async (spec: { reference: string; source: string }) => {
        built.push(spec);
        return { reference: spec.reference, digest: 'sha256:abcdef012345', layers: ['a'] };
      } },
    });

    const result = await findCommand('build')!.run([], context);

    assert.deepEqual(asked, ['Image reference', 'Source directory']);
    assert.equal(built[0]?.reference, 'myproject/base:1.0');
    assert.match(result.entries[0]?.title ?? '', /built/);
  });

  it('/build still takes both arguments without asking anything', async () => {
    const { context, asked } = asking([], {
      cwd: 'C:/project',
      engine: { buildImage: async () => ({ reference: 'x:1', digest: 'sha256:abc', layers: [] }) },
    });
    await findCommand('build')!.run(['x:1', 'src'], context);
    assert.deepEqual(asked, []);
  });

  it('treats Esc at a prompt as changing your mind, not as an error', async () => {
    const { context } = asking([null], {
      cwd: 'C:/project',
      engine: { buildImage: async () => { throw new Error('must not build'); } },
    });
    const result = await findCommand('build')!.run([], context);
    assert.match(result.entries[0]?.title ?? '', /cancelled/);
  });

  it('/goal offers to set one, and to clear it only when there is one', async () => {
    const withGoal = harness({
      goalStatus: () => ({ status: 'active', condition: 'npm test passes' }),
      startGoal: async () => undefined,
      clearGoal: async () => undefined,
    });
    await findCommand('goal')!.run([], withGoal.context);
    assert.deepEqual(withGoal.opened[0]!.items.map((item) => item.value), ['set', 'clear']);
    assert.match(withGoal.opened[0]!.title, /active/);

    const without = harness({
      goalStatus: () => null,
      startGoal: async () => undefined,
      clearGoal: async () => undefined,
    });
    await findCommand('goal')!.run([], without.context);
    assert.deepEqual(without.opened[0]!.items.map((item) => item.value), ['set']);
  });

  it('/goal takes a condition typed inline without opening a menu', async () => {
    const started: string[] = [];
    const { context, opened } = harness({
      goalStatus: () => null,
      startGoal: async (condition: string) => { started.push(condition); },
      clearGoal: async () => undefined,
    });
    await findCommand('goal')!.run(['npm', 'test', 'passes'], context);

    assert.equal(opened.length, 0);
    assert.deepEqual(started, ['npm test passes']);
  });
});

describe('/sandbox', () => {
  const base = {
    backend: 'win32-job',
    isolation: 'job',
    killProcessTree: true,
    memoryLimit: true,
    processLimit: true,
    cpuLimit: false,
    filesystemWriteBlock: false,
    networkBlock: false,
    accounting: true,
    textEncoding: 'utf-8',
  };

  it('reports directly when the machine enforces everything it claims', async () => {
    // One thing to say, so a menu with a single row would be ceremony.
    const { context, opened } = harness({
      engine: { sandboxReport: { ...base, degradations: [] } },
    });
    const result = await findCommand('sandbox')!.run([], context);

    assert.equal(opened.length, 0);
    assert.match(result.entries[0]?.title ?? '', /win32-job/);
  });

  it('offers the gaps as their own view when there are any', async () => {
    const { context, opened } = harness({
      engine: {
        sandboxReport: { ...base, degradations: ['no cgroup delegation', 'no network namespace'] },
      },
    });
    await findCommand('sandbox')!.run([], context);

    assert.deepEqual(opened[0]!.items.map((item) => item.value), ['enforcement', 'degradations']);
    assert.match(opened[0]!.items[1]?.detail ?? '', /2 gap/);
  });
});
