import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { highlightShell } from '../src/shell-highlight.js';

describe('shell command highlighting', () => {
  it('preserves PowerShell exactly and identifies useful syntax roles', () => {
    const source = "Get-Content $file | Select-Object -First 10 # preview";
    const tokens = highlightShell(source);
    assert.equal(tokens.map((token) => token.text).join(''), source);
    assert.ok(tokens.some((token) => token.kind === 'command' && token.text.includes('Get-Content')));
    assert.ok(tokens.some((token) => token.kind === 'variable'));
    assert.ok(tokens.some((token) => token.kind === 'parameter'));
    assert.equal(tokens.at(-1)?.kind, 'comment');
  });

  it('preserves Bash strings, options and operators', () => {
    const source = "rg -n 'TODO' src | head -20";
    const tokens = highlightShell(source);
    assert.equal(tokens.map((token) => token.text).join(''), source);
    assert.ok(tokens.some((token) => token.kind === 'string'));
    assert.ok(tokens.some((token) => token.kind === 'operator'));
  });
});
