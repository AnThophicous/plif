import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { terminalToolOutput } from '../src/harness/loop.js';

describe('terminal tool output policy', () => {
  it('keeps read content private to the model', () => {
    assert.equal(terminalToolOutput('read_file', { output: 'secret source body', ok: true }), '');
  });

  it('shows shell, write, edit and directory-list output', () => {
    for (const name of ['run_command', 'shell_command', 'write_file', 'edit_file', 'list_dir']) {
      assert.equal(terminalToolOutput(name, { output: 'visible', display: 'full display', ok: true }), 'full display');
    }
  });

  it('passes structured discovery results to the expressive CLI renderer', () => {
    for (const name of ['web_search', 'research']) {
      assert.equal(
        terminalToolOutput(name, { output: '1. Source\nhttps://example.test', ok: true }),
        '1. Source\nhttps://example.test',
      );
    }
  });

  it('keeps one short error line for a hidden-output tool', () => {
    const output = terminalToolOutput('read_file', {
      output: `permission denied\n${'x'.repeat(800)}`,
      ok: false,
    });
    assert.equal(output, 'permission denied');
  });
});
