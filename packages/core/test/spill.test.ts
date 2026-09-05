/**
 * Spilling oversized tool output to a file instead of into the context.
 *
 * Two properties matter and they pull in opposite directions: the context has
 * to get small, and nothing may be lost. The old behaviour got the first by
 * giving up the second — it deleted the middle. These tests hold both.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Container } from '../src/container/container.js';
import {
  SPILL_DIRECTORY,
  SPILL_THRESHOLD,
  SpillStore,
  describeSpill,
  spillLargeOutput,
  type SpillRecord,
  type SpillSink,
} from '../src/harness/spill.js';

/** A container that keeps written files in memory. */
function fakeContainer(options: { failWrites?: boolean } = {}): {
  container: Container;
  files: Map<string, string>;
} {
  const files = new Map<string, string>();
  const container = {
    async writeFile(virtualPath: string, contents: string): Promise<void> {
      if (options.failWrites) throw new Error('read-only');
      files.set(virtualPath, contents);
    },
  } as unknown as Container;
  return { container, files };
}

/** A sink that records what it was asked to keep. */
function recordingSink(): { sink: SpillSink; written: string[] } {
  const written: string[] = [];
  return {
    written,
    sink: {
      async write(_label, text): Promise<SpillRecord> {
        written.push(text);
        return { path: '/temp/spill/0001-x.txt', bytes: text.length, lines: text.split('\n').length };
      },
    },
  };
}

describe('the spill store', () => {
  it('writes under the temp mount, numbered in the order it was asked', async () => {
    const { container, files } = fakeContainer();
    const store = new SpillStore(container);

    const first = await store.write('grep', 'a'.repeat(10));
    const second = await store.write('read big.ts', 'b'.repeat(10));

    assert.equal(first?.path, `${SPILL_DIRECTORY}/0001-grep.txt`);
    // The label is sanitised into the filename rather than trusted.
    assert.equal(second?.path, `${SPILL_DIRECTORY}/0002-read-big-ts.txt`);
    assert.equal(files.get(first!.path), 'a'.repeat(10));
  });

  it('reports the size in the units a reader cares about', async () => {
    const { container } = fakeContainer();
    const record = await new SpillStore(container).write('x', 'one\ntwo\nthree');
    assert.equal(record?.lines, 3);
    assert.equal(record?.bytes, 13);
  });

  it('returns null instead of failing when the container cannot write', async () => {
    // Spilling is an optimisation. A container with no writable temp mount must
    // still be able to run a tool that produces a lot of output.
    const { container } = fakeContainer({ failWrites: true });
    assert.equal(await new SpillStore(container).write('x', 'y'.repeat(100)), null);
  });
});

describe('deciding whether to spill', () => {
  it('leaves small output alone, so a short answer costs no round trip', async () => {
    const { sink, written } = recordingSink();
    const text = 'short output';
    assert.equal(await spillLargeOutput(text, 'x', sink), text);
    assert.deepEqual(written, []);
  });

  it('spills once the output is worth a file', async () => {
    const { sink, written } = recordingSink();
    const text = 'x'.repeat(SPILL_THRESHOLD);
    const result = await spillLargeOutput(text, 'x', sink);

    assert.notEqual(result, text);
    assert.equal(written.length, 1);
    // The file holds everything; only the context is shortened.
    assert.equal(written[0], text);
  });

  it('hands the text back unchanged when there is no sink', async () => {
    const text = 'x'.repeat(SPILL_THRESHOLD);
    assert.equal(await spillLargeOutput(text, 'x', undefined), text);
  });

  it('hands the text back unchanged when the sink could not write', async () => {
    const sink: SpillSink = { async write() { return null; } };
    const text = 'x'.repeat(SPILL_THRESHOLD);
    assert.equal(await spillLargeOutput(text, 'x', sink), text);
  });
});

describe('what the model reads', () => {
  const text = ['FIRST LINE', ...Array.from({ length: 5_000 }, (_, i) => `line ${i}`), 'LAST LINE'].join('\n');
  const record: SpillRecord = {
    path: '/temp/spill/0001-grep.txt',
    bytes: text.length,
    lines: text.split('\n').length,
  };

  it('is far smaller than the output it stands for', async () => {
    const described = describeSpill(record, text);
    assert.ok(described.length < text.length / 10, 'the preview must be a fraction of the output');
  });

  it('keeps the head and the tail, which is where the answer usually is', () => {
    const described = describeSpill(record, text);
    assert.match(described, /FIRST LINE/);
    assert.match(described, /LAST LINE/);
  });

  it('names the path and the tools that open it', () => {
    // A model told only that output was "truncated" stops, because truncation
    // is not something it can act on. A model given a path and two tool names
    // goes and gets the part it needs.
    const described = describeSpill(record, text);
    assert.match(described, /\/temp\/spill\/0001-grep\.txt/);
    assert.match(described, /grep/);
    assert.match(described, /read_file/);
  });

  it('says nothing was lost, because nothing was', () => {
    assert.match(describeSpill(record, text), /Nothing was lost/);
  });

  it('states the real size, not the preview size', () => {
    const described = describeSpill(record, text);
    assert.match(described, /5,002 lines/);
  });
});
