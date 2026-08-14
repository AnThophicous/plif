import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createTerminalSurfaceStream,
  needsTerminalSurfaceTail,
  terminalSurfaceTail,
} from '../src/terminal-surface-output.js';

describe('terminal surface output', () => {
  it('paints the reserved row with the active panel color', () => {
    assert.equal(needsTerminalSurfaceTail('frame\n'), true);
    assert.equal(needsTerminalSurfaceTail('\u001b[2Jframe'), true);
    assert.equal(needsTerminalSurfaceTail('frame'), false);
    assert.equal(
      terminalSurfaceTail('#171719'),
      '\u001b[48;2;23;23;25m\u001b[2K\u001b[49m',
    );
  });

  it('keeps Ink stream properties and appends no line to its accounting', () => {
    const writes: (string | Uint8Array)[] = [];
    const target = {
      columns: 80,
      rows: 40,
      write(chunk: string | Uint8Array): boolean {
        writes.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WriteStream;

    const stream = createTerminalSurfaceStream(target, () => '#171719');
    stream.write('frame\n');
    stream.write('cursor');

    assert.equal(stream.columns, 80);
    assert.equal(stream.rows, 40);
    assert.equal(writes.length, 2);
    assert.equal(writes[0], `frame\n${terminalSurfaceTail('#171719')}`);
    assert.equal(writes[1], 'cursor');
  });
});
