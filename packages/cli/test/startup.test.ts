import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  INTERACTIVE_CLEAR,
  renderStartupIdentity,
  startInteractiveSurface,
} from '../src/startup.js';
import { VERSION, VERSION_LABEL } from '../src/version.js';

class Output {
  readonly writes: string[] = [];

  constructor(
    readonly isTTY: boolean,
    readonly columns = 80,
  ) {}

  write(value: string): boolean {
    this.writes.push(value);
    return true;
  }
}

describe('interactive startup surface', () => {
  it('clears and homes exactly once before printing identity', () => {
    const output = new Output(true, 48);
    assert.equal(startInteractiveSurface(output, {
      version: VERSION_LABEL,
      workspace: 'C:\\src\\plif',
    }), true);

    assert.equal(output.writes[0], INTERACTIVE_CLEAR);
    assert.equal(output.writes.filter((write) => write.includes('\u001B[2J')).length, 1);
    assert.match(output.writes[1] ?? '', new RegExp(`Plif ${VERSION_LABEL.replaceAll('.', '\\.')}`));
  });

  it('does not clear or print an interactive header to a non-TTY stream', () => {
    const output = new Output(false);
    assert.equal(startInteractiveSurface(output, {
      version: VERSION_LABEL,
      workspace: 'C:\\src\\plif',
    }), false);
    assert.deepEqual(output.writes, []);
  });

  for (const width of [28, 48, 80]) {
    it(`keeps the identity-only opening within two rows at ${width} columns`, () => {
      const identity = renderStartupIdentity({
        version: VERSION_LABEL,
        workspace: 'C:\\a-very-long-workspace-name\\plif-code',
        width,
      });
      const lines = identity.trimEnd().split('\n');
      assert.ok(lines.length <= 2);
      assert.ok(lines.every((line) => [...line].length <= width));
      assert.match(lines.join('\n'), /Plif/);
      assert.doesNotMatch(lines.join('\n'), /model|sandbox|opencode/i);
    });
  }

  it('reads the published CLI version from package metadata', async () => {
    const manifest = await import('../package.json', { with: { type: 'json' } });
    assert.equal(VERSION, manifest.default.version);
    assert.equal(VERSION_LABEL, '0.3.5');
  });
});
