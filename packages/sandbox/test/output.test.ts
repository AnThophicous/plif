/**
 * Output capture and decoding.
 *
 * Two invariants worth pinning down, because breaking either is silent:
 *
 *   - the ceiling actually caps, and reports that it did
 *   - what is streamed live is a prefix of what is captured
 *
 * A live view that shows text the final transcript omits means the developer
 * and the agent are reading different accounts of the same command.
 */

import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';

import { BoundedBuffer, captureOutput } from '../src/output.js';
import { consoleDecoder, decoderDescription } from '../src/encoding.js';

const utf8 = (bytes: Buffer): string => bytes.toString('utf8');

describe('BoundedBuffer', () => {
  it('keeps everything under the ceiling and reports the kept slice', () => {
    const buffer = new BoundedBuffer(100, utf8);
    const kept = buffer.push(Buffer.from('hello'));

    assert.equal(kept.toString(), 'hello');
    assert.equal(buffer.text(), 'hello');
    assert.equal(buffer.truncated, false);
  });

  it('caps at the ceiling and returns only the part it kept', () => {
    const buffer = new BoundedBuffer(4, utf8);
    const kept = buffer.push(Buffer.from('abcdefgh'));

    assert.equal(kept.toString(), 'abcd');
    assert.equal(buffer.text(), 'abcd');
    assert.equal(buffer.truncated, true);
  });

  it('drops entirely once full, rather than growing past the ceiling', () => {
    const buffer = new BoundedBuffer(4, utf8);
    buffer.push(Buffer.from('abcd'));
    const kept = buffer.push(Buffer.from('efgh'));

    assert.equal(kept.length, 0);
    assert.equal(buffer.size, 4);
    assert.equal(buffer.truncated, true);
  });

  it('decodes the whole buffer at once, reassembling a split character', () => {
    // "é" is 0xC3 0xA9 in UTF-8. Arriving as two reads must not produce two
    // replacement characters — this is exactly what a pipe read boundary does.
    const buffer = new BoundedBuffer(100, utf8);
    buffer.push(Buffer.from([0xc3]));
    buffer.push(Buffer.from([0xa9]));

    assert.equal(buffer.text(), 'é');
  });
});

describe('captureOutput', () => {
  it('streams exactly what it later reports as captured', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const streamed: string[] = [];

    const capture = captureOutput({ stdout, stderr }, 1000, utf8, (_stream, chunk) =>
      streamed.push(chunk),
    );

    stdout.write('one ');
    stdout.write('two');
    stdout.end();
    await new Promise((resolve) => stdout.on('end', resolve).resume());

    assert.equal(streamed.join(''), 'one two');
    assert.equal(capture.stdout.text(), 'one two');
    assert.equal(capture.truncated(), false);
  });

  it('does not stream output that the ceiling will drop', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const streamed: string[] = [];

    const capture = captureOutput({ stdout, stderr }, 3, utf8, (_stream, chunk) =>
      streamed.push(chunk),
    );

    stdout.write('abcdef');
    stdout.end();
    await new Promise((resolve) => stdout.on('end', resolve).resume());

    assert.equal(streamed.join(''), 'abc');
    assert.equal(capture.stdout.text(), 'abc');
    assert.equal(capture.truncated(), true);
  });

  it('keeps stdout and stderr separate', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const seen: string[] = [];

    const capture = captureOutput({ stdout, stderr }, 1000, utf8, (stream, chunk) =>
      seen.push(`${stream}:${chunk}`),
    );

    stdout.write('out');
    stderr.write('err');
    stdout.end();
    stderr.end();
    await Promise.all([
      new Promise((resolve) => stdout.on('end', resolve).resume()),
      new Promise((resolve) => stderr.on('end', resolve).resume()),
    ]);

    assert.deepEqual(seen.sort(), ['stderr:err', 'stdout:out']);
    assert.equal(capture.stdout.text(), 'out');
    assert.equal(capture.stderr.text(), 'err');
  });
});

describe('consoleDecoder', () => {
  it('resolves to something and describes itself', async () => {
    const decode = await consoleDecoder();
    assert.equal(typeof decode, 'function');
    assert.ok(decoderDescription().length > 0);
  });

  it('round-trips ASCII on every platform', async () => {
    const decode = await consoleDecoder();
    assert.equal(decode(Buffer.from('plain ascii')), 'plain ascii');
  });

  it('returns empty string for empty input rather than calling into the OS', async () => {
    const decode = await consoleDecoder();
    assert.equal(decode(Buffer.alloc(0)), '');
  });

  it(
    'decodes OEM high bytes that UTF-8 would mangle',
    { skip: process.platform !== 'win32' },
    async () => {
      const decode = await consoleDecoder();
      // 0xA3 is "ú" in CP850 and invalid as standalone UTF-8. If the host's OEM
      // codepage is already 65001 there is nothing to prove, so only assert the
      // interesting case.
      if (!decoderDescription().startsWith('OEM codepage')) return;

      const bytes = Buffer.from([0x6e, 0xa3, 0x6d, 0x65, 0x72, 0x6f]);
      assert.equal(decode(bytes).includes('�'), false);
      assert.equal(bytes.toString('utf8').includes('�'), true);
    },
  );
});
