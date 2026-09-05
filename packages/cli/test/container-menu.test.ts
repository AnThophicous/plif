/**
 * The container commands, as menus.
 *
 * The flow they replace was: run `/ps`, read a name off a printed table,
 * remember it, type `/stop <name>`. These tests hold the two properties that
 * make the menu version worth having — the name never has to be transcribed,
 * and typing it still works for anyone who already knows it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findCommand } from '../src/commands.js';
import type { CommandContext } from '../src/commands.js';

interface OpenedPicker {
  readonly title: string;
  readonly items: readonly { value: string; label: string; detail?: string; current?: boolean }[];
  readonly onPick: (value: string) => void;
}

function fakeContainer(name: string, state = 'running') {
  return {
    name,
    id: `${name}-0123456789abcdef`,
    status: () => ({ state, usage: { execCount: 3, peakMemoryBytes: 1024 * 1024 } }),
  };
}

function harness(containers: readonly ReturnType<typeof fakeContainer>[], current?: string) {
  const opened: OpenedPicker[] = [];
  const context = {
    engine: {
      list: () => containers,
      require: (ref: string) => containers.find((item) => item.name === ref),
    },
    current: current ? containers.find((item) => item.name === current) : undefined,
    setCurrent: () => undefined,
    openPicker: (request: unknown) => {
      if (request && typeof request === 'object' && 'items' in request) {
        opened.push(request as OpenedPicker);
      }
    },
    notify: () => undefined,
  } as unknown as CommandContext;
  return { context, opened };
}

describe('/ps', () => {
  it('offers every container as a row instead of printing a table', async () => {
    const { context, opened } = harness([fakeContainer('alpha'), fakeContainer('beta')]);
    const result = await findCommand('ps')!.run([], context);

    assert.equal(result.entries.length, 0, 'the menu is the output; nothing is printed');
    assert.equal(opened.length, 1);
    assert.deepEqual(opened[0]!.items.map((item) => item.value), ['alpha', 'beta']);
  });

  it('keeps the facts the printed table carried', async () => {
    const { context, opened } = harness([fakeContainer('alpha')]);
    await findCommand('ps')!.run([], context);
    const detail = opened[0]!.items[0]!.detail ?? '';

    assert.match(detail, /alpha-01/, 'the short id');
    assert.match(detail, /running/, 'the state');
    assert.match(detail, /3 execs/, 'the exec count');
  });

  it('marks the targeted container and starts the cursor there', async () => {
    const { context, opened } = harness(
      [fakeContainer('alpha'), fakeContainer('beta')],
      'beta',
    );
    await findCommand('ps')!.run([], context);

    assert.equal(opened[0]!.items[1]?.current, true);
    assert.match(opened[0]!.items[1]?.detail ?? '', /active/);
  });

  it('says so plainly when there is nothing to list', async () => {
    const { context, opened } = harness([]);
    const result = await findCommand('ps')!.run([], context);

    assert.equal(opened.length, 0, 'an empty menu is worse than a sentence');
    assert.match(result.entries[0]?.title ?? '', /No containers/);
  });

  it('opens the verbs for the container that was chosen', async () => {
    const { context, opened } = harness([fakeContainer('alpha')]);
    await findCommand('ps')!.run([], context);
    opened[0]!.onPick('alpha');

    assert.equal(opened.length, 2);
    assert.match(opened[1]!.title, /alpha/);
    assert.deepEqual(opened[1]!.items.map((item) => item.value), ['use', 'stop', 'rm']);
  });

  it('does not offer commit, which needs a layer name a picker cannot supply', async () => {
    // Offering it would pass the container name as the layer name.
    const { context, opened } = harness([fakeContainer('alpha')]);
    await findCommand('ps')!.run([], context);
    opened[0]!.onPick('alpha');

    assert.ok(!opened[1]!.items.some((item) => item.value === 'commit'));
  });
});

describe('/use', () => {
  it('opens the picker when called bare, where it used to be an error', async () => {
    const { context, opened } = harness([fakeContainer('alpha')]);
    await findCommand('use')!.run([], context);
    assert.equal(opened.length, 1);
    assert.match(opened[0]!.title, /Target/);
  });

  it('still takes a name directly, because typing a known name is faster', async () => {
    const { context, opened } = harness([fakeContainer('alpha')]);
    const result = await findCommand('use')!.run(['alpha'], context);
    assert.equal(opened.length, 0);
    assert.match(result.entries[0]?.title ?? '', /alpha/);
  });
});

describe('/stop and /rm', () => {
  it('offer the list when nothing is targeted, rather than refusing', async () => {
    for (const name of ['stop', 'rm']) {
      const { context, opened } = harness([fakeContainer('alpha')]);
      await findCommand(name)!.run([], context);
      assert.equal(opened.length, 1, `${name} should have opened a picker`);
    }
  });

  it('still act on the targeted container without asking', async () => {
    // The fast path is unchanged: a container is already targeted, so the verb
    // applies to it and no menu appears.
    const stopped: string[] = [];
    const container = {
      ...fakeContainer('alpha'),
      stop: async (reason: string) => { stopped.push(reason); },
    };
    const { context, opened } = harness([container], 'alpha');
    await findCommand('stop')!.run([], context);

    assert.equal(opened.length, 0);
    assert.equal(stopped.length, 1);
  });
});
