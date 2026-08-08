/**
 * Scheduling tool calls, and knowing when a repeat is legitimate.
 *
 * Both are about the loop trusting the tools' own declarations instead of
 * hardcoding names. A tool says whether it is safe to run beside others, and
 * whether asking it the same thing twice can honestly return something new.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_PARALLEL_SAFE_CALLS, scheduleBatches } from '../src/harness/loop.js';
import { DEFAULT_TOOLS, toolRegistry } from '../src/harness/tools.js';
import type { Tool } from '../src/harness/tools.js';
import type { ToolCall } from '../src/model/provider.js';

const registry = toolRegistry(DEFAULT_TOOLS);

const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({
  id: `${name}-${Math.random().toString(36).slice(2, 8)}`,
  name,
  arguments: JSON.stringify(args),
});

const names = (batches: ToolCall[][]): string[][] =>
  batches.map((batch) => batch.map((item) => item.name));

describe('batching parallel-safe calls', () => {
  it('runs consecutive reads together', () => {
    const batches = scheduleBatches(
      [call('read_file'), call('read_file'), call('list_dir')],
      registry,
    );
    assert.deepEqual(names(batches), [['read_file', 'read_file', 'list_dir']]);
  });

  it('caps a long run of safe calls at three per batch', () => {
    const batches = scheduleBatches(
      Array.from({ length: 7 }, () => call('read_file')),
      registry,
    );
    assert.equal(MAX_PARALLEL_SAFE_CALLS, 3);
    assert.deepEqual(batches.map((batch) => batch.length), [3, 3, 1]);
  });

  it('keeps a write between the reads that surround it', () => {
    // The ordering guarantee the model is entitled to: batching may remove
    // round trips, never reorder effects.
    const batches = scheduleBatches(
      [call('read_file'), call('read_file'), call('write_file'), call('read_file')],
      registry,
    );
    assert.deepEqual(names(batches), [
      ['read_file', 'read_file'],
      ['write_file'],
      ['read_file'],
    ]);
  });

  it('never batches run_command, however many are asked for', () => {
    // Two shells writing into one live output stream cannot be told apart, and
    // a command can do anything to anything.
    const batches = scheduleBatches([call('run_command'), call('run_command')], registry);
    assert.deepEqual(names(batches), [['run_command'], ['run_command']]);
  });

  it('gives an unknown tool a batch of its own', () => {
    // No spec means no claim of safety. The failure it produces should also not
    // be able to take a legitimate call down with it.
    const batches = scheduleBatches([call('read_file'), call('nope'), call('read_file')], registry);
    assert.deepEqual(names(batches), [['read_file'], ['nope'], ['read_file']]);
  });

  it('returns nothing for nothing', () => {
    assert.deepEqual(scheduleBatches([], registry), []);
  });
});

describe('which tools declare what', () => {
  const find = (name: string): Tool => {
    const tool = registry.get(name);
    assert.ok(tool, `${name} should exist`);
    return tool;
  };

  it('marks reads parallel-safe and effects not', () => {
    assert.equal(find('read_file').parallelSafe, true);
    assert.equal(find('list_dir').parallelSafe, true);
    assert.equal(find('write_file').parallelSafe, undefined);
    assert.equal(find('run_command').parallelSafe, undefined);
    assert.equal(find('start_task').parallelSafe, undefined);
  });

  it('marks the polling tools repeatable', () => {
    // The reported failure: the model started a background task, asked
    // task_status three times to watch it, and was refused every time by a
    // guard meant for retried failures.
    assert.equal(find('task_status').repeatable, true);
    assert.equal(find('list_tasks').repeatable, true);
    assert.equal(find('ask_user').repeatable, true);

    assert.equal(find('read_file').repeatable, undefined);
    assert.equal(find('run_command').repeatable, undefined);
  });
});
