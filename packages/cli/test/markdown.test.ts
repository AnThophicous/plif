import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseInline, parseMarkdown, plainText, wrapSpans } from '../src/markdown.js';

describe('inline parsing', () => {
  it('reads bold, which is the emphasis the prompt tells the agent to spend carefully', () => {
    const spans = parseInline('the **cause** was an off-by-one');

    assert.deepEqual(
      spans.map((span) => [span.style, span.text]),
      [
        ['plain', 'the '],
        ['bold', 'cause'],
        ['plain', ' was an off-by-one'],
      ],
    );
  });

  it('reads code, italics, strikethrough and links', () => {
    assert.equal(parseInline('`npm test`')[0]?.style, 'code');
    assert.equal(parseInline('*maybe*')[0]?.style, 'italic');
    assert.equal(parseInline('~~gone~~')[0]?.style, 'strike');

    const link = parseInline('[the docs](https://example.test)');
    assert.equal(link[0]?.style, 'link');
    assert.equal(link[0]?.text, 'the docs');
  });

  it('leaves plain text alone', () => {
    const spans = parseInline('nothing special here');
    assert.equal(spans.length, 1);
    assert.equal(spans[0]?.style, 'plain');
  });

  it('does not treat a lone asterisk as emphasis', () => {
    assert.equal(plainText(parseInline('2 * 3 = 6')), '2 * 3 = 6');
  });
});

describe('block parsing', () => {
  it('keeps a fenced code block intact, with its language', () => {
    const blocks = parseMarkdown('before\n```ts\nconst a = 1;\nconst b = 2;\n```\nafter');
    const code = blocks.find((block) => block.kind === 'code');

    assert.ok(code && code.kind === 'code');
    assert.equal(code.language, 'ts');
    assert.deepEqual(code.lines, ['const a = 1;', 'const b = 2;']);
  });

  it('does not parse markdown inside a code fence', () => {
    const blocks = parseMarkdown('```\n**not bold**\n```');
    const code = blocks.find((block) => block.kind === 'code');

    assert.ok(code && code.kind === 'code');
    assert.equal(code.lines[0], '**not bold**');
  });

  it('reads headings, bullets and quotes', () => {
    const blocks = parseMarkdown('## Title\n- one\n- two\n> quoted');
    const kinds = blocks.map((block) => block.kind);

    assert.deepEqual(kinds, ['heading', 'bullet', 'bullet', 'quote']);
  });

  it('keeps numbered list markers', () => {
    const blocks = parseMarkdown('1. first\n2. second');
    assert.equal(blocks[0]?.kind === 'bullet' && blocks[0].marker, '1.');
  });

  it('tracks nesting depth on indented bullets', () => {
    const blocks = parseMarkdown('- outer\n  - inner');
    assert.equal(blocks[0]?.kind === 'bullet' && blocks[0].indent, 0);
    assert.equal(blocks[1]?.kind === 'bullet' && blocks[1].indent, 1);
  });

  it('drops trailing blank lines so answers do not end in dead space', () => {
    const blocks = parseMarkdown('text\n\n\n');
    assert.equal(blocks.at(-1)?.kind, 'text');
  });
});

describe('wrapping', () => {
  it('never exceeds the width it was given', () => {
    const spans = parseInline('the quick brown fox jumps over the lazy dog again and again');

    for (const width of [10, 20, 40]) {
      for (const line of wrapSpans(spans, width)) {
        assert.ok(
          plainText(line).length <= width,
          `line of ${plainText(line).length} exceeds ${width}`,
        );
      }
    }
  });

  it('preserves styling across a line break', () => {
    // A bold phrase that wraps must stay bold on both lines, or the emphasis
    // silently disappears halfway through the sentence it was applied to.
    const spans = parseInline('plain **a very long bold phrase that will not fit** tail');
    const lines = wrapSpans(spans, 20);
    const boldWords = lines.flat().filter((span) => span.style === 'bold');

    assert.ok(boldWords.length > 1, 'bold phrase was not split across lines');
    assert.ok(lines.length > 1);
  });

  it('breaks a word longer than the width rather than overflowing', () => {
    const lines = wrapSpans(parseInline('x'.repeat(50)), 10);
    for (const line of lines) assert.ok(plainText(line).length <= 10);
  });

  it('round-trips the text content', () => {
    const source = 'one two three four five six seven eight';
    const joined = wrapSpans(parseInline(source), 12)
      .map((line) => plainText(line))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    assert.equal(joined, source);
  });
});
