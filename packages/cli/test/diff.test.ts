/**
 * Rendering an edit.
 *
 * The one invariant that matters here: colouring must never change what the
 * developer is shown. A highlighter that drops or reorders a character turns
 * the diff — the only report of what an agent did to their code — into a
 * plausible-looking lie.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { diffLines, formatDiff } from '@plif/core';

import { diffHeight } from '../src/components/Diff.js';
import { highlight, languageOf } from '../src/highlight.js';
import { entry } from '../src/session.js';
import { estimateHeight } from '../src/components/Timeline.js';

const SAMPLES = [
  'const x = 1;',
  '  return `hello ${name}`;',
  '// a trailing comment',
  'if (a < b && c > d) { call(x, "y"); }',
  "const s = 'unterminated",
  'def main(argv: list[str]) -> int:',
  '',
  '        ',
  'x = 0xFF + 1_000 + 2.5e-3',
  'weird ✦ unicode — em dash',
];

describe('highlight', () => {
  it('never changes the text, in any language', () => {
    for (const language of ['ts', 'py', 'go', 'rs', 'sh', 'json', 'plain']) {
      for (const sample of SAMPLES) {
        const rebuilt = highlight(sample, language)
          .map((token) => token.text)
          .join('');
        assert.equal(rebuilt, sample, `${language}: ${JSON.stringify(sample)}`);
      }
    }
  });

  it('always returns at least one token, so a caller can map over it', () => {
    for (const sample of SAMPLES) {
      assert.ok(highlight(sample, 'ts').length >= 1);
    }
  });

  it('classifies code by semantic theme roles', () => {
    const tokens = highlight('const total = sum("4") + 2;', 'ts');
    const roleOf = (text: string): string | undefined =>
      tokens.find((token) => token.text.includes(text))?.kind;

    assert.equal(roleOf('const'), 'keyword');
    assert.equal(roleOf('total'), 'variable');
    assert.equal(roleOf('sum'), 'function');
    assert.equal(roleOf('"4"'), 'string');
    assert.equal(roleOf('+'), 'operator');
    assert.equal(roleOf('2'), 'number');
  });

  it('treats a whole-line comment as one dim run', () => {
    const tokens = highlight('  // explain the invariant', 'ts');
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0]?.kind, 'comment');
  });

  it('does not mistake C++ dereferences or CSS universal selectors for comments', () => {
    for (const [language, source] of [
      ['cpp', '*ptr = value;'],
      ['css', '* { box-sizing: border-box; }'],
    ] as const) {
      const tokens = highlight(source, language);
      assert.equal(tokens.map((token) => token.text).join(''), source);
      assert.notEqual(tokens[0]?.kind, 'comment');
      assert.ok(tokens.some((token) => token.kind === 'operator' && token.text.includes('*')));
    }
  });

  it('does not try to colour an unknown file type', () => {
    assert.equal(languageOf('notes.txt'), 'plain');
    assert.deepEqual(highlight('anything at all', 'plain'), [
      { text: 'anything at all', kind: 'plain' },
    ]);
  });

  it('maps the extensions that actually show up', () => {
    assert.equal(languageOf('src/app.tsx'), 'ts');
    assert.equal(languageOf('build.mjs'), 'ts');
    assert.equal(languageOf('main.py'), 'py');
    assert.equal(languageOf('config.jsonc'), 'json');
    assert.equal(languageOf('config.toml'), 'toml');
    assert.equal(languageOf('index.html'), 'html');
    assert.equal(languageOf('styles.css'), 'css');
    assert.equal(languageOf('main.cpp'), 'cpp');
  });
});

describe('diff row height', () => {
  const diff = formatDiff('a.ts', diffLines('a\nb\nc\nd\ne', 'a\nB\nc\nd\ne'));

  it('is measured from the diff, not from the output text', () => {
    // The estimate drives the scrollback budget. Measuring the one-line tool
    // output instead of the diff under it would under-reserve by however many
    // lines the edit touched, and an under-reserved frame is the full-repaint
    // bug this budget exists to prevent.
    const row = entry('tool', 'Update', { status: 'done', diff, detail: 'edited a.ts' });
    assert.ok(estimateHeight(row, 80) >= diffHeight(diff, false));
  });

  it('grows when the row is expanded', () => {
    const long = formatDiff(
      'a.ts',
      diffLines(
        Array.from({ length: 60 }, (_, index) => `line ${index}`).join('\n'),
        Array.from({ length: 60 }, (_, index) => `changed ${index}`).join('\n'),
      ),
    );
    assert.ok(diffHeight(long, true) > diffHeight(long, false));
  });

  it('reserves room for automatic language-server feedback under an edit', () => {
    const plain = entry('tool', 'Update', { status: 'done', diff });
    const diagnosed = entry('tool', 'Update', {
      status: 'failed',
      diff,
      detail: 'Language server: 1 error(s), 0 warning(s)\na.ts:2:1 TS2322: wrong type',
    });
    assert.equal(estimateHeight(diagnosed, 80) - estimateHeight(plain, 80), 2);
  });
});
