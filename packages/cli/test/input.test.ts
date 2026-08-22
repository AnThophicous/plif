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

import {
  PASTE_ATTACHMENT_MIN_CHARS,
  imagePathsInPaste,
  isTerminalPaste,
  pastedContentToken,
  sanitizePastedText,
  shouldAttachPastedText,
  splitPaste,
  tokenize,
} from '../src/format.js';
import { IDLE_PASTE, hasPasteMarker, readPasteChunk } from '../src/paste.js';
import {
  commandPrefix,
  completeCommand,
  findCommand,
  isExactCommandMatch,
  matchArgumentCompletions,
  matchCommands,
  tabArgumentCompletion,
  COMMANDS,
} from '../src/commands.js';
import type { FlatPickerRequest, CommandContext } from '../src/commands.js';
import {
  ALL_SUFFIX,
  PICKER_GROUP_PAGE,
  effortLabel,
  effortPickerItems,
  filterPickerGroups,
  flattenPickerGroups,
  pickerRows,
  pickerSelectionForCurrentModel,
  preservePickerSelection,
} from '../src/components/Picker.js';
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

describe('command completion input', () => {
  it('keeps the command prefix when arguments are already being typed', () => {
    assert.equal(commandPrefix('/model'), 'model');
    assert.equal(commandPrefix('/model openai/gpt-4o-mini'), 'model');
    assert.deepEqual(matchCommands(commandPrefix('/model --') ?? ''), [findCommand('model')]);
    assert.equal(commandPrefix('plain text'), null);
    assert.deepEqual(completeCommand('eff'), ['effort']);
  });

  it('does not treat an exact one-row command completion as arrow navigation', () => {
    const effort = findCommand('effort')!;
    assert.equal(isExactCommandMatch(effort, 'effort'), true);
    assert.equal(isExactCommandMatch(effort, 'eff'), false);
  });

  it('completes a unique effort argument from the active model capability', () => {
    const context = {
      supportedEfforts: () => ['low', 'medium', 'high', 'xhigh'] as const,
    } as unknown as CommandContext;

    const low = matchArgumentCompletions('/effort l', '/effort l'.length, context);
    const xhigh = matchArgumentCompletions('/effort x', '/effort x'.length, context);
    const none = matchArgumentCompletions('/effort z', '/effort z'.length, context);

    assert.deepEqual(low?.matches.map((match) => match.value), ['low']);
    assert.equal(tabArgumentCompletion(low!), 'low');
    assert.deepEqual(xhigh?.matches.map((match) => match.value), ['xhigh']);
    assert.equal(tabArgumentCompletion(xhigh!), 'xhigh');
    assert.deepEqual(none?.matches, []);
    assert.equal(tabArgumentCompletion(none!), null);
  });

  it('keeps ambiguous arguments visible without choosing one', () => {
    const context = {
      supportedEfforts: () => ['medium', 'max'] as const,
    } as unknown as CommandContext;
    const state = matchArgumentCompletions('/effort m', '/effort m'.length, context);

    assert.deepEqual(state?.matches.map((match) => match.value), ['medium', 'max']);
    assert.equal(tabArgumentCompletion(state!), null);
  });

  it('supports empty arguments, repeated spaces, cursor positions, and dynamic models', () => {
    const context = {
      supportedEfforts: () => ['low', 'medium'] as const,
      modelCompletionValues: () => ['my-model', 'my-more'],
    } as unknown as CommandContext;
    const empty = matchArgumentCompletions('/effort ', '/effort '.length, context);
    const spaced = matchArgumentCompletions('/effort   h', '/effort   h'.length, {
      supportedEfforts: () => ['high'] as const,
    } as unknown as CommandContext);
    const inTheMiddle = '/effort h other';
    const middle = matchArgumentCompletions(inTheMiddle, inTheMiddle.indexOf('h') + 1, {
      supportedEfforts: () => ['high'] as const,
    } as unknown as CommandContext);
    const models = matchArgumentCompletions('/model my-', '/model my-'.length, context);

    assert.deepEqual(empty?.matches.map((match) => match.value), ['default', 'low', 'medium']);
    assert.equal(tabArgumentCompletion(spaced!), 'high');
    assert.equal(tabArgumentCompletion(middle!), 'high');
    assert.deepEqual(models?.matches.map((match) => match.value), ['my-model', 'my-more']);
    assert.equal(tabArgumentCompletion(models!), 'my-mo');
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

  it('keeps complete pasted text available for an attachment', () => {
    assert.equal(sanitizePastedText('one\r\ntwo\u001b[31m'), 'one\ntwo[31m');
    assert.equal(pastedContentToken(1, 'one\ntwo'), '✧ Plif Pasted 2 lines');
    assert.equal(pastedContentToken(2, 'one\r\ntwo\r\n'), '✧ Plif Pasted 2 lines');
    assert.equal(pastedContentToken(3, 'one'), '✧ Plif Pasted 1 line');
    assert.equal(pastedContentToken(2), '[Pasted Image #2]');
  });
});

describe('when a paste becomes an attachment', () => {
  it('leaves anything shorter than the threshold as ordinary typing', () => {
    assert.equal(shouldAttachPastedText(''), false);
    assert.equal(shouldAttachPastedText('a stack trace line'), false);
    assert.equal(shouldAttachPastedText('x'.repeat(PASTE_ATTACHMENT_MIN_CHARS - 1)), false);
  });

  it('attaches once the paste reaches the threshold', () => {
    assert.equal(shouldAttachPastedText('x'.repeat(PASTE_ATTACHMENT_MIN_CHARS)), true);
    assert.equal(shouldAttachPastedText('x'.repeat(PASTE_ATTACHMENT_MIN_CHARS + 1)), true);
  });

  it('uses the character threshold even when a paste has multiple lines', () => {
    assert.equal(PASTE_ATTACHMENT_MIN_CHARS, 201);
    assert.equal(shouldAttachPastedText('x'.repeat(200)), false);
    assert.equal(shouldAttachPastedText('x'.repeat(201)), true);
    assert.equal(shouldAttachPastedText('one\ntwo\nthree\nfour'), false);
    assert.equal(shouldAttachPastedText(Array.from({ length: 60 }, () => 'line').join('\n')), true);
  });
});

describe('image files arriving as pasted text', () => {
  it('recognises a Windows path to an image', () => {
    assert.deepEqual(
      imagePathsInPaste('C:\\Users\\dev\\Pictures\\erro.png'),
      ['C:\\Users\\dev\\Pictures\\erro.png'],
    );
  });

  it('unwraps the quotes Explorer puts around a copied path', () => {
    assert.deepEqual(
      imagePathsInPaste('"C:\\Users\\dev\\Pictures\\meu print.PNG"'),
      ['C:\\Users\\dev\\Pictures\\meu print.PNG'],
    );
  });

  it('takes several images pasted as one block', () => {
    assert.deepEqual(
      imagePathsInPaste('C:\\a\\one.png\nC:\\a\\two.jpeg'),
      ['C:\\a\\one.png', 'C:\\a\\two.jpeg'],
    );
  });

  it('decodes a file:// URI back into a path', () => {
    assert.deepEqual(
      imagePathsInPaste('file:///C:/Users/dev/Pictures/erro%20novo.png'),
      ['C:\\Users\\dev\\Pictures\\erro novo.png'],
    );
  });

  it('accepts posix paths too', () => {
    assert.deepEqual(imagePathsInPaste('/home/dev/shot.webp'), ['/home/dev/shot.webp']);
    assert.deepEqual(imagePathsInPaste('./docs/diagram.gif'), ['./docs/diagram.gif']);
  });

  it('refuses anything that is not entirely image paths', () => {
    assert.deepEqual(imagePathsInPaste('olha esse erro aqui'), []);
    assert.deepEqual(imagePathsInPaste('C:\\Users\\dev\\notes.txt'), []);
    assert.deepEqual(imagePathsInPaste('C:\\a\\one.png\nand also this text'), []);
    assert.deepEqual(imagePathsInPaste('png'), []);
    assert.deepEqual(imagePathsInPaste(''), []);
  });

  it('does not mistake a sentence mentioning a png for a path', () => {
    assert.deepEqual(imagePathsInPaste('salvei em erro.png'), []);
  });
});

describe('isTerminalPaste', () => {
  it('never mistakes coalesced typing for a paste', () => {
    // Ink hands over whatever `stdin.read()` had buffered, so a repeated space
    // or two keystrokes landing in the same frame arrive as one chunk. Calling
    // those a paste is what turned typed sentences into attachments.
    assert.equal(isTerminalPaste(' '), false);
    assert.equal(isTerminalPaste('  '), false);
    assert.equal(isTerminalPaste('da '), false);
    assert.equal(isTerminalPaste('colado'), false);
    assert.equal(isTerminalPaste('🧑‍💻'), false);
  });

  it('treats a chunk ending in a newline as typing plus Enter, not a paste', () => {
    assert.equal(isTerminalPaste('npm test\r'), false);
    assert.equal(isTerminalPaste('npm test\r\n'), false);
  });

  it('accepts more than one line of content, which a keyboard cannot produce', () => {
    assert.equal(isTerminalPaste('first\nsecond'), true);
    assert.equal(isTerminalPaste('first\r\nsecond\r\n'), true);
  });
});

describe('bracketed paste', () => {
  const ESC = String.fromCharCode(27);
  const OPEN = `${ESC}[200~`;
  const CLOSE = `${ESC}[201~`;
  const wrap = (text: string): string => `${OPEN}${text}${CLOSE}`;

  it('reads a whole paste out of one chunk', () => {
    const read = readPasteChunk(IDLE_PASTE, wrap('one\ntwo'));
    assert.deepEqual(read.segments, [{ pasted: true, text: 'one\ntwo' }]);
    assert.deepEqual(read.state, IDLE_PASTE);
  });

  it('restores the escape byte Ink strips from the head of a chunk', () => {
    // useInput drops a leading ESC before the handler ever sees it, so the
    // opening marker arrives as a bare `[200~`.
    const read = readPasteChunk(IDLE_PASTE, `[200~text${CLOSE}`);
    assert.deepEqual(read.segments, [{ pasted: true, text: 'text' }]);
  });

  it('joins a paste split across reads', () => {
    const first = readPasteChunk(IDLE_PASTE, `${OPEN}alpha`);
    assert.deepEqual(first.segments, []);
    assert.equal(first.state.open, true);

    const second = readPasteChunk(first.state, `beta${CLOSE}`);
    assert.deepEqual(second.segments, [{ pasted: true, text: 'alphabeta' }]);
    assert.equal(second.state.open, false);
  });

  it('joins a paste whose closing marker is itself split', () => {
    const first = readPasteChunk(IDLE_PASTE, `${OPEN}alpha${ESC}[20`);
    assert.deepEqual(first.segments, []);

    const second = readPasteChunk(first.state, '1~');
    assert.deepEqual(second.segments, [{ pasted: true, text: 'alpha' }]);
    assert.equal(second.state.open, false);
  });

  it('keeps keystrokes on either side of the markers as keystrokes', () => {
    const read = readPasteChunk(IDLE_PASTE, `a${wrap('x')}b`);
    assert.deepEqual(read.segments, [
      { pasted: false, text: 'a' },
      { pasted: true, text: 'x' },
      { pasted: false, text: 'b' },
    ]);
  });

  it('reports a marker only when one is actually present', () => {
    assert.equal(hasPasteMarker(' '), false);
    assert.equal(hasPasteMarker('colado'), false);
    assert.equal(hasPasteMarker('[200~x'), true);
    assert.equal(hasPasteMarker(wrap('x')), true);
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

  it('shows only the first page of a crowded provider, with a way to see the rest', () => {
    // A gateway with hundreds of models must not push every other provider off
    // the screen the moment it is opened.
    const crowded: readonly PickerGroup[] = [
      {
        id: 'openrouter',
        label: 'OpenRouter',
        items: Array.from({ length: 25 }, (_, index) => ({
          value: `model-${index}`,
          label: `Model ${index}`,
        })),
      },
    ];

    const paged = flattenPickerGroups(crowded, ['openrouter']);
    assert.equal(paged.filter((row) => row.kind === 'item').length, PICKER_GROUP_PAGE);
    const last = paged.at(-1);
    assert.equal(last?.kind, 'more');
    assert.equal(last?.kind === 'more' ? last.hidden : 0, 15);

    const all = flattenPickerGroups(crowded, ['openrouter', `openrouter${ALL_SUFFIX}`]);
    assert.equal(all.filter((row) => row.kind === 'item').length, 25);
    assert.equal(all.some((row) => row.kind === 'more'), false);
  });

  it('opens matching providers while a model search is active', () => {
    const filtered = filterPickerGroups(groups, 'flash');
    const rows = flattenPickerGroups(filtered, [], 'flash');

    assert.ok(rows.some((row) => row.kind === 'item'));
  });

  it('keeps the selected model identity when filtering changes its row index', () => {
    const expanded = ['opencode', 'openai'];
    const before = pickerRows(groups, expanded);
    const selected = before.findIndex((row) => row.id === 'openai:gpt-4o-mini');
    const after = pickerRows(groups, expanded, 'mini');
    assert.equal(after[preservePickerSelection(before, selected, after)]?.id, 'openai:gpt-4o-mini');
  });

  it('starts on the active model row instead of its provider header', () => {
    const activeGroups: readonly PickerGroup[] = [
      groups[0]!,
      {
        ...groups[1]!,
        items: [{ ...groups[1]!.items[0]!, current: true }, ...groups[1]!.items.slice(1)],
      },
    ];
    const expanded = ['openai'];
    const rows = pickerRows(activeGroups, expanded);
    const selected = pickerSelectionForCurrentModel(activeGroups, expanded, 'openai');

    assert.equal(rows[selected]?.id, 'openai:gpt-4o-mini');
    assert.equal(selected, 2);
  });

  it('keeps a crowded catalog bounded when the active model is outside its first page', () => {
    const crowded: readonly PickerGroup[] = [
      {
        id: 'openrouter',
        label: 'OpenRouter',
        items: Array.from({ length: 25 }, (_, index) => ({
          value: `model-${index}`,
          label: `Model ${index}`,
          current: index === 24,
        })),
      },
    ];
    const expanded = ['openrouter'];
    const rows = pickerRows(crowded, expanded);
    const selected = pickerSelectionForCurrentModel(crowded, expanded, 'openrouter');

    assert.equal(rows[selected]?.id, 'openrouter');
    assert.equal(rows.filter((row) => row.kind === 'item').length, PICKER_GROUP_PAGE);
  });

  it('forgets the long tail when a provider is collapsed', () => {
    const opened = sessionReducer(initialSession, {
      type: 'picker.open',
      picker: {
        title: 'select a model',
        groups,
        expanded: ['opencode', `opencode${ALL_SUFFIX}`],
        onPick: () => undefined,
      },
    });
    const collapsed = sessionReducer(opened, { type: 'picker.toggle', id: 'opencode' });
    assert.deepEqual(collapsed.picker?.expanded, []);
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
    let picker: FlatPickerRequest | undefined;
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
        if ('items' in request) picker = request;
      },
    };

    const result = await findCommand('model')!.run([], context);

    assert.deepEqual(result.entries, []);
    // `/models` is model-first and availability-gated: it is flat, searchable,
    // and carries the provider identity on each row without exposing locked
    // providers as if their models were immediately usable.
    assert.equal(picker?.countLabel, 'available');
    assert.equal(picker?.selected, 0);
    assert.match(picker?.hint ?? '', /Current\s+none/);
    assert.match(picker?.hint ?? '', /Add providers with \/providers to unlock more models/);
    assert.ok(picker?.items?.every((item) => item.provider));
    assert.ok(picker?.items?.some((item) => item.provider === 'OpenCode Zen'));
    assert.ok(picker?.items?.some((item) => item.value === 'opencode:deepseek-v4-flash-free'));
    assert.ok(!picker?.items?.some((item) => item.value === 'anthropic:claude-opus-5'));
  });

  it('labels the internal adaptive effort as PLIF and marks the active effort', () => {
    assert.equal(effortLabel('plif'), 'PLIF');
    assert.equal(effortLabel(undefined), 'Default');
    assert.deepEqual(
      effortPickerItems(['low', 'plif'], 'plif').map((item) => ({
        value: item.value,
        label: item.label,
        tone: item.tone,
        detail: item.detail,
        current: item.current,
      })),
      [
        { value: 'low', label: 'Low', tone: 'faint', detail: 'light touch', current: false },
        { value: 'plif', label: 'PLIF', tone: 'accentBright', detail: 'PLIF signature mode · adaptive reasoning', current: true },
      ],
    );
  });

  it('clamps picker navigation instead of wrapping to the opposite edge', () => {
    const opened = sessionReducer(initialSession, {
      type: 'picker.open',
      picker: {
        title: 'select an effort',
        items: [
          { value: 'low', label: 'Low' },
          { value: 'high', label: 'High' },
        ],
        onPick: () => undefined,
      },
    });
    const top = sessionReducer(opened, { type: 'picker.move', delta: -1 });
    assert.equal(top.picker?.selected, 0);
    const bottom = sessionReducer(top, { type: 'picker.move', delta: 9 });
    assert.equal(bottom.picker?.selected, 1);
    const stillBottom = sessionReducer(bottom, { type: 'picker.move', delta: 1 });
    assert.equal(stillBottom.picker?.selected, 1);
  });

  it('applies an effort and closes its picker in one state transition', () => {
    const opened = sessionReducer(initialSession, {
      type: 'picker.open',
      picker: {
        title: 'select an effort',
        items: [{ value: 'max', label: 'Max' }, { value: 'plif', label: 'PLIF' }],
        onPick: () => undefined,
      },
    });
    const applied = sessionReducer(opened, { type: 'effort.apply', effort: 'plif' });

    assert.equal(applied.effort, 'plif');
    assert.equal(applied.picker, null);
    assert.equal(sessionReducer(applied, { type: 'picker.close' }), applied);
  });
});
