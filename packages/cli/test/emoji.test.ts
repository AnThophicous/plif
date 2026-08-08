/**
 * `:name:` shortcodes, and the colons that are not shortcodes.
 *
 * The whole risk of this feature is false positives. A single colon is the most
 * overloaded character a developer types — namespaces, URLs, times, drive
 * letters, type annotations, ternaries, object literals — and a menu that
 * opened on any of them would be in the way constantly, while an expansion that
 * fired on one would silently corrupt what was typed.
 *
 * So most of what is asserted here is that nothing happens.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EMOJI, expandShortcodes, findEmoji, matchEmoji, openShortcode } from '../src/emoji.js';

describe('expandShortcodes', () => {
  it('replaces a shortcode at the start of a word', () => {
    assert.equal(expandShortcodes('bugou :sob:'), 'bugou 😭');
    assert.equal(expandShortcodes(':fire: this is good'), '🔥 this is good');
  });

  it('replaces several in one line', () => {
    assert.equal(expandShortcodes(':fire: and :rocket:'), '🔥 and 🚀');
  });

  it('resolves aliases to the same glyph', () => {
    assert.equal(expandShortcodes(':+1:'), expandShortcodes(':thumbsup:'));
    assert.equal(expandShortcodes(':kkk:'), '🤣');
  });

  it('leaves an unknown name exactly as typed', () => {
    // Deleting it would lose text the developer meant to send.
    assert.equal(expandShortcodes('run :deploy: now'), 'run :deploy: now');
  });
});

describe('colons that are not shortcodes', () => {
  const untouched = [
    'std::collections::HashMap',
    'use std::fmt;',
    'https://plif.dev',
    'see http://example.com/a:b',
    'meet at 12:30',
    'C:\\Users\\dev',
    '{ key: value }',
    'const x: string = a ? b : c',
    'git log --format=%H:%s',
    'docker run -v /a:/b image:tag',
    'ssh user@host:/path',
    'ERROR:root:something failed',
  ];

  for (const line of untouched) {
    it(`leaves ${JSON.stringify(line)} alone`, () => {
      assert.equal(expandShortcodes(line), line);
    });
  }

  it('does not expand a name glued to a word', () => {
    // `image:tag:` after a word is a tag, not an emoji, even when the middle
    // happens to be a name in the list.
    assert.equal(expandShortcodes('build:fire:now'), 'build:fire:now');
  });
});

describe('openShortcode', () => {
  it('opens after a space', () => {
    const open = openShortcode('bugou :so', 9);
    assert.deepEqual(open, { start: 6, fragment: 'so' });
  });

  it('opens at the start of the input', () => {
    assert.deepEqual(openShortcode(':fi', 3), { start: 0, fragment: 'fi' });
  });

  it('stays shut on a lone colon', () => {
    // Every menu has to be dismissed. One that appeared on `:` would appear
    // constantly.
    assert.equal(openShortcode('note:', 5), null);
    assert.equal(openShortcode(':', 1), null);
  });

  it('stays shut inside a namespace path', () => {
    assert.equal(openShortcode('std::vec', 8), null);
    assert.equal(openShortcode('std::', 5), null);
  });

  it('stays shut after a digit or a letter', () => {
    assert.equal(openShortcode('12:30', 5), null);
    assert.equal(openShortcode('http://x', 8), null);
  });

  it('closes again once a space is typed', () => {
    assert.equal(openShortcode('say :sob then', 13), null);
  });

  it('tracks the cursor, not the end of the line', () => {
    // The developer went back to fix an earlier word; the menu belongs there.
    const open = openShortcode('a :fi and :rocket:', 5);
    assert.deepEqual(open, { start: 2, fragment: 'fi' });
  });
});

describe('matchEmoji', () => {
  it('ranks a prefix match above a substring one', () => {
    const names = matchEmoji('fi').map((entry) => entry.name);
    assert.equal(names[0], 'fire');
  });

  it('finds an entry by alias', () => {
    assert.ok(matchEmoji('lol').some((entry) => entry.emoji === '😂'));
  });

  it('returns nothing for a name nobody has', () => {
    assert.deepEqual(matchEmoji('zzzzzz'), []);
  });

  it('never repeats a glyph, even when two names reach it', () => {
    const found = matchEmoji('thumb');
    assert.equal(new Set(found.map((entry) => entry.emoji)).size, found.length);
  });
});

describe('the list itself', () => {
  it('has no duplicate names or aliases', () => {
    const seen = new Set<string>();
    for (const entry of EMOJI) {
      for (const name of [entry.name, ...(entry.aliases ?? [])]) {
        assert.ok(!seen.has(name), `duplicate name: ${name}`);
        seen.add(name);
      }
    }
  });

  it('uses only lowercase shortcode-safe names', () => {
    for (const entry of EMOJI) {
      for (const name of [entry.name, ...(entry.aliases ?? [])]) {
        assert.match(name, /^[a-z0-9_+-]+$/, `unusable name: ${name}`);
      }
    }
  });

  it('resolves every name it advertises', () => {
    for (const entry of EMOJI) {
      assert.equal(findEmoji(entry.name)?.emoji, entry.emoji);
      for (const alias of entry.aliases ?? []) {
        assert.equal(findEmoji(alias)?.emoji, entry.emoji);
      }
    }
  });
});
