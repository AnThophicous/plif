/**
 * Input handling.
 *
 * `tokenize` decides what argv a typed line becomes, and `splitPaste` decides
 * what a paste is allowed to put in the buffer. Both sit directly between the
 * keyboard and process execution, so they get tested even though they look
 * trivial — the failure modes are "ran the wrong command" and "ran a command
 * the user never saw".
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { splitPaste, tokenize } from '../src/format.js';
import { matchCommands, findCommand, COMMANDS } from '../src/commands.js';
import type { CatalogPickerRequest, CommandContext } from '../src/commands.js';
import { filterPickerGroups, flattenPickerGroups } from '../src/components/Picker.js';
import type { PickerGroup } from '../src/components/Picker.js';
import type { Engine } from '@plif/core';
import { initialSession, sessionReducer } from '../src/session.js';

describe('tokenize', () => {
  it('splits on whitespace', () => {
    assert.deepEqual(tokenize('npm run build'), ['npm', 'run', 'build']);
    assert.deepEqual(tokenize('  spaced   out  '), ['spaced', 'out']);
    assert.deepEqual(tokenize(''), []);
  });

  it('keeps quoted paths with spaces in one token', () => {
    assert.deepEqual(tokenize('cat "C:/Program Files/x.txt"'), [
      'cat',
      'C:/Program Files/x.txt',
    ]);
  });

  it('does not expand shell metacharacters', () => {
    // These must survive as literal argv elements. If they were interpreted, a
    // policy rule matching on argv would be checking a command line that is not
    // the one that runs.
    assert.deepEqual(tokenize('echo a && rm -rf b'), ['echo', 'a', '&&', 'rm', '-rf', 'b']);
    assert.deepEqual(tokenize('echo $HOME'), ['echo', '$HOME']);
    assert.deepEqual(tokenize('ls *.ts'), ['ls', '*.ts']);
  });
});

describe('splitPaste', () => {
  it('passes ordinary typing straight through', () => {
    assert.deepEqual(splitPaste('a'), { text: 'a', submitted: false });
    assert.deepEqual(splitPaste('hello'), { text: 'hello', submitted: false });
  });

  it('submits on a newline and keeps only the first line', () => {
    assert.deepEqual(splitPaste('npm test\r'), { text: 'npm test', submitted: true });
    assert.deepEqual(splitPaste('first\nsecond\nthird'), { text: 'first', submitted: true });
  });

  it('strips control bytes rather than inserting them', () => {
    // A pasted escape sequence must never reach the rendered buffer, where
    // echoing it could repaint the screen.
    const escape = '\u001b[31mred\u001b[0m';
    const { text } = splitPaste(escape);
    assert.equal(text.includes('\u001b'), false);
    assert.equal(text, '[31mred[0m');
  });

  it('strips DEL and NUL', () => {
    assert.equal(splitPaste('a\u0000b\u007fc').text, 'abc');
  });
});

describe('matchCommands', () => {
  it('ranks prefix matches above substring matches', () => {
    const results = matchCommands('st');
    const names = results.map((command) => command.name);

    const stop = names.indexOf('stop');
    const store = names.indexOf('store');
    assert.ok(stop >= 0 && store >= 0, `expected stop and store, got ${names.join(',')}`);
    // Both start with "st", so both are prefix matches; what matters is that a
    // pure substring match cannot outrank them.
    const firstNonPrefix = names.findIndex((name) => !name.startsWith('st'));
    if (firstNonPrefix !== -1) {
      assert.ok(Math.max(stop, store) < firstNonPrefix);
    }
  });

  it('returns everything for an empty prefix, so "/" opens the full menu', () => {
    assert.equal(matchCommands('').length, COMMANDS.length);
  });

  it('returns nothing for a prefix no command matches', () => {
    assert.deepEqual(matchCommands('zzzz'), []);
  });
});

describe('the command table', () => {
  it('has unique names, since /help and dispatch read the same table', () => {
    const names = COMMANDS.map((command) => command.name);
    assert.equal(new Set(names).size, names.length);
  });

  it('gives every command a summary for the menu', () => {
    for (const command of COMMANDS) {
      assert.ok(command.summary.length > 0, `${command.name} has no summary`);
    }
  });

  it('resolves each declared name through findCommand', () => {
    for (const command of COMMANDS) {
      assert.equal(findCommand(command.name)?.name, command.name);
    }
    assert.equal(findCommand('nope'), null);
  });
});

describe('model catalog picker', () => {
  const groups: readonly PickerGroup[] = [
    {
      id: 'opencode',
      label: 'OpenCode Zen',
      detail: 'free models',
      items: [
        {
          value: 'deepseek-v4-flash-free',
          label: 'DeepSeek V4 Flash Free',
          detail: 'default',
          badges: ['default'],
        },
      ],
    },
    {
      id: 'openai',
      label: 'OpenAI',
      detail: 'hosted models',
      items: [{ value: 'gpt-4o-mini', label: 'GPT-4o mini' }],
    },
  ];

  it('keeps the provider visible when a child matches', () => {
    const filtered = filterPickerGroups(groups, 'flash');
    assert.deepEqual(filtered.map((group) => group.id), ['opencode']);
    assert.deepEqual(filtered[0]?.items.map((item) => item.value), ['deepseek-v4-flash-free']);
  });

  it('flattens only expanded providers in source order', () => {
    assert.deepEqual(
      flattenPickerGroups(groups, ['opencode']).map((row) => `${row.kind}:${row.id}`),
      ['group:opencode', 'item:opencode:deepseek-v4-flash-free', 'group:openai'],
    );
  });

  it('moves through visible rows and clamps after collapsing a provider', () => {
    const opened = sessionReducer(initialSession, {
      type: 'picker.open',
      picker: {
        title: 'select a model',
        groups,
        expanded: ['opencode'],
        selected: 1,
        onPick: () => undefined,
      },
    });
    const moved = sessionReducer(opened, { type: 'picker.moveVisible', delta: 1 });
    assert.equal(moved.picker?.selected, 2);

    const collapsed = sessionReducer(opened, { type: 'picker.toggle', id: 'opencode' });
    assert.deepEqual(collapsed.picker?.expanded, []);
    assert.equal(collapsed.picker?.selected, 1);
  });

  it('opens the catalog when no provider is loaded', async () => {
    let picker: CatalogPickerRequest | undefined;
    const context: CommandContext = {
      engine: {} as Engine,
      current: null,
      setCurrent: () => undefined,
      clear: () => undefined,
      exit: () => undefined,
      cwd: process.cwd(),
      model: null,
      modelProblem: 'no API key for a remote endpoint',
      switchModel: async () => undefined,
      setEffort: async () => undefined,
      openPicker: (request) => {
        if ('groups' in request) picker = request;
      },
    };

    const result = await findCommand('model')!.run([], context);

    assert.deepEqual(result.entries, []);
    assert.equal(picker?.groups[0]?.id, 'opencode');
    assert.deepEqual(picker?.expanded, ['opencode']);
    assert.equal(picker?.selected, 1);
    assert.equal(picker?.groups[0]?.items[0]?.value, 'deepseek-v4-flash-free');
  });
});
