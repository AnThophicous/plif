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

  it('patches only changed Ink rows after establishing a frame baseline', () => {
    const writes: string[] = [];
    const target = {
      write(chunk: string | Uint8Array): boolean {
        writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      },
    } as unknown as NodeJS.WriteStream;

    const stream = createTerminalSurfaceStream(target, () => '#171719');
    const eraseLines = (count: number): string =>
      `${'\u001b[2K\u001b[1A'.repeat(Math.max(0, count - 1))}\u001b[2K\u001b[G`;

    // The first frame and the frame after scrollback have no erase prefix.
    stream.write('alpha\nbeta\n');
    stream.write(`${eraseLines(3)}alpha\nbeta\n`);
    const before = writes.length;

    stream.write(`${eraseLines(3)}alpha\nBETA\n`);
    const patch = writes.at(-1) ?? '';

    assert.equal(writes.length, before + 1);
    assert.match(patch, /\u001b\[1A/);
    assert.match(patch, /\u001b\[2KBETA/);
    assert.match(patch, /\u001b\[1B/);
    assert.doesNotMatch(patch, /\u001b\[2A/);
    assert.doesNotMatch(patch, /alpha/);
  });

  it('does not walk or repaint the frame when its rows are unchanged', () => {
    const writes: string[] = [];
    const target = {
      write(chunk: string | Uint8Array): boolean {
        writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      },
    } as unknown as NodeJS.WriteStream;

    const stream = createTerminalSurfaceStream(target, () => '#171719');
    const eraseLines = (count: number): string =>
      `${'\u001b[2K\u001b[1A'.repeat(Math.max(0, count - 1))}\u001b[2K\u001b[G`;

    stream.write('alpha\nbeta\n');
    stream.write(`${eraseLines(3)}alpha\nbeta\n`);
    const before = writes.length;

    stream.write(`${eraseLines(3)}alpha\nbeta\n`);

    assert.equal(writes.length, before);
  });

  it('jumps directly to a changed lower row instead of crossing the whole frame', () => {
    const writes: string[] = [];
    const target = {
      write(chunk: string | Uint8Array): boolean {
        writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      },
    } as unknown as NodeJS.WriteStream;

    const stream = createTerminalSurfaceStream(target, () => '#171719');
    const eraseLines = (count: number): string =>
      `${'\u001b[2K\u001b[1A'.repeat(Math.max(0, count - 1))}\u001b[2K\u001b[G`;
    const before = Array.from({ length: 32 }, (_, index) => `row ${index}`).join('\n') + '\n';
    const after = Array.from({ length: 32 }, (_, index) => index === 31 ? 'changed' : `row ${index}`).join('\n') + '\n';

    stream.write(before);
    stream.write(`${eraseLines(33)}${before}`);
    stream.write(`${eraseLines(33)}${after}`);
    const patch = writes.at(-1) ?? '';

    assert.match(patch, /\u001b\[1A/);
    assert.match(patch, /\u001b\[1B/);
    assert.doesNotMatch(patch, /\u001b\[32B/);
    assert.doesNotMatch(patch, /\u001b\[48;2;/);
    assert.doesNotMatch(patch, /row 0/);
  });

  it('repaints the full reflowed frame once after dimensions change, then resumes row diffs', () => {
    const writes: string[] = [];
    const target = {
      columns: 10,
      rows: 20,
      write(chunk: string | Uint8Array): boolean {
        writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    const stream = createTerminalSurfaceStream(target, () => '#171719');
    const eraseLines = (count: number): string =>
      `${'\u001b[2K\u001b[1A'.repeat(Math.max(0, count - 1))}\u001b[2K\u001b[G`;
    const before = '\u001b[31m12345678🙂\u001b[39m\nbeta\n';
    const after = '12345\nBETA\n';

    stream.write(before);
    stream.write(`${eraseLines(3)}${before}`);
    target.columns = 5;
    target.rows = 12;
    stream.write(`${eraseLines(3)}${after}`);

    assert.equal(
      writes.at(-1),
      `${eraseLines(4)}${after}${terminalSurfaceTail('#171719')}`,
      'the 10-cell ANSI/emoji row reflows to two physical rows at five columns',
    );

    stream.write(`${eraseLines(3)}12345\nbeta\n`);
    const incremental = writes.at(-1) ?? '';
    assert.match(incremental, /\u001b\[2Kbeta/);
    assert.doesNotMatch(incremental, /12345/);
  });

  it('uses reflowed rows when a resize is followed by Ink scrollback cleanup', () => {
    const writes: string[] = [];
    const target = {
      columns: 10,
      rows: 20,
      write(chunk: string | Uint8Array): boolean {
        writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    const stream = createTerminalSurfaceStream(target, () => '#171719');
    const eraseLines = (count: number): string =>
      `${'\u001b[2K\u001b[1A'.repeat(Math.max(0, count - 1))}\u001b[2K\u001b[G`;
    const frame = '1234567890\nbeta\n';

    stream.write(frame);
    stream.write(`${eraseLines(3)}${frame}`);
    target.columns = 5;
    stream.write(eraseLines(3));

    assert.equal(writes.at(-1), eraseLines(4));
    stream.write('history\n');
    assert.equal(writes.at(-1), `history\n${terminalSurfaceTail('#171719')}`);
  });

  it('drops the baseline when Ink clears for append-only scrollback', () => {
    const writes: string[] = [];
    const target = {
      write(chunk: string | Uint8Array): boolean {
        writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      },
    } as unknown as NodeJS.WriteStream;

    const stream = createTerminalSurfaceStream(target, () => '#171719');
    const eraseLines = (count: number): string =>
      `${'\u001b[2K\u001b[1A'.repeat(Math.max(0, count - 1))}\u001b[2K\u001b[G`;

    stream.write('live one\nlive two\n');
    stream.write(`${eraseLines(3)}live one\nlive two\n`);
    stream.write(eraseLines(3));
    stream.write('history\n');

    assert.equal(writes.at(-1), `history\n${terminalSurfaceTail('#171719')}`);
  });
});
