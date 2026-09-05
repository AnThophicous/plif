/**
 * Hooks: parsing, matching, and the exit-code contract.
 *
 * The exit codes carry the whole semantics — 0 allows, 2 blocks, anything else
 * failed — and confusing the last two is the failure that matters: a hook
 * whose interpreter is missing must not become a deny-all that makes the agent
 * look broken.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Container } from '../src/container/container.js';
import type { ExecRequest, ExecResult } from '../src/types.js';
import { BashDialect } from '../src/execution/shell-dialects.js';
import {
  HookRunner,
  describeHookOutcome,
  hookMatches,
  parseHooks,
  type HookDefinition,
} from '../src/harness/hooks.js';

const dialect = new BashDialect('bash');

/** A container that records what it was asked to run and answers as told. */
function fakeContainer(
  reply: (request: ExecRequest) => Partial<ExecResult>,
): { container: Container; calls: ExecRequest[] } {
  const calls: ExecRequest[] = [];
  const container = {
    async exec(request: ExecRequest): Promise<ExecResult> {
      calls.push(request);
      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
        truncated: false,
        durationMs: 1,
        ...reply(request),
      };
    },
  } as unknown as Container;
  return { container, calls };
}

function hook(overrides: Partial<HookDefinition> = {}): HookDefinition {
  return { event: 'tool.before', command: 'true', ...overrides };
}

describe('hook configuration', () => {
  it('reads a well-formed table', () => {
    const { hooks, problems } = parseHooks([
      { event: 'tool.before', match: '^edit_file$', command: 'npm run lint', name: 'lint' },
    ]);
    assert.deepEqual(problems, []);
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0]?.event, 'tool.before');
    assert.equal(hooks[0]?.name, 'lint');
  });

  it('treats an absent table as no hooks rather than an error', () => {
    assert.deepEqual(parseHooks(undefined), { hooks: [], problems: [] });
    assert.deepEqual(parseHooks(null), { hooks: [], problems: [] });
  });

  it('drops a bad entry, keeps the good ones, and says which it dropped', () => {
    // One typo must not stop a session from starting, and must not be silent.
    const { hooks, problems } = parseHooks([
      { event: 'nope', command: 'x' },
      { event: 'tool.after', command: '   ' },
      { event: 'tool.after', command: 'echo ok' },
    ]);
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0]?.command, 'echo ok');
    assert.equal(problems.length, 2);
    assert.match(problems[0] ?? '', /hook #1/);
    assert.match(problems[1] ?? '', /hook #2/);
  });

  it('rejects an invalid match pattern instead of silently never firing', () => {
    const { hooks, problems } = parseHooks([{ event: 'tool.before', match: '(', command: 'x' }]);
    assert.equal(hooks.length, 0);
    assert.match(problems[0] ?? '', /invalid match pattern/);
  });

  it('rejects a non-list hooks value', () => {
    assert.match(parseHooks({ event: 'tool.before' }).problems[0] ?? '', /list of/);
  });
});

describe('hook matching', () => {
  it('matches every event of its kind when no pattern is given', () => {
    assert.equal(hookMatches(hook(), { event: 'tool.before', subject: 'anything' }), true);
  });

  it('does not fire for a different event', () => {
    assert.equal(hookMatches(hook(), { event: 'tool.after', subject: 'x' }), false);
  });

  it('is a substring match unless the pattern is anchored', () => {
    const loose = hook({ match: 'edit_file' });
    const exact = hook({ match: '^edit_file$' });
    assert.equal(hookMatches(loose, { event: 'tool.before', subject: 'edit_file_v2' }), true);
    assert.equal(hookMatches(exact, { event: 'tool.before', subject: 'edit_file_v2' }), false);
  });
});

describe('hook execution', () => {
  it('is inert when the machine has no shell', async () => {
    const { container, calls } = fakeContainer(() => ({}));
    const runner = new HookRunner({ container, hooks: [hook()] });
    const outcome = await runner.run({ event: 'tool.before', subject: 'edit_file' });
    assert.deepEqual(calls, []);
    assert.equal(outcome.blocked, undefined);
    assert.equal(runner.has('tool.before'), false);
  });

  it('passes the event as variables and as JSON on stdin', async () => {
    const { container, calls } = fakeContainer(() => ({}));
    const runner = new HookRunner({ container, hooks: [hook()], dialect });
    await runner.run({ event: 'tool.before', subject: 'edit_file', data: { path: '/project/a.ts' } });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.env?.['PLIF_HOOK_EVENT'], 'tool.before');
    assert.equal(calls[0]?.env?.['PLIF_HOOK_SUBJECT'], 'edit_file');
    assert.deepEqual(JSON.parse(calls[0]?.stdin ?? '{}'), {
      event: 'tool.before',
      subject: 'edit_file',
      data: { path: '/project/a.ts' },
    });
    // The command goes through the dialect, so it reaches exec as argv rather
    // than as a string somebody has to quote correctly.
    assert.equal(calls[0]?.argv[0], 'bash');
  });

  it('exit 0 allows, and non-empty stdout becomes context', async () => {
    const { container } = fakeContainer(() => ({ exitCode: 0, stdout: 'formatted 2 files' }));
    const runner = new HookRunner({ container, hooks: [hook()], dialect });
    const outcome = await runner.run({ event: 'tool.before', subject: 'edit_file' });
    assert.equal(outcome.blocked, undefined);
    assert.deepEqual(outcome.context, ['formatted 2 files']);
  });

  it('exit 2 blocks, and stderr is the reason', async () => {
    const { container } = fakeContainer(() => ({ exitCode: 2, stderr: 'protected path' }));
    const runner = new HookRunner({
      container,
      hooks: [hook({ name: 'guard' })],
      dialect,
    });
    const outcome = await runner.run({ event: 'tool.before', subject: 'write_file' });
    assert.equal(outcome.blocked?.reason, 'protected path');
    assert.equal(outcome.blocked?.hook, 'guard');
  });

  it('any other exit code is a failure that does NOT block', async () => {
    // The distinction that matters: a hook whose interpreter is missing exits
    // 127, and turning that into a deny-all makes every tool call fail for a
    // reason nothing on screen explains.
    const { container } = fakeContainer(() => ({ exitCode: 127, stderr: 'command not found' }));
    const runner = new HookRunner({ container, hooks: [hook({ name: 'lint' })], dialect });
    const outcome = await runner.run({ event: 'tool.before', subject: 'edit_file' });
    assert.equal(outcome.blocked, undefined);
    assert.deepEqual(outcome.failures, [{ hook: 'lint', detail: 'command not found' }]);
  });

  it('will not let a late event pretend it blocked something', async () => {
    // tool.after runs when the tool already ran. A 2 there is reported as a
    // mistake rather than silently doing nothing.
    const { container } = fakeContainer(() => ({ exitCode: 2, stderr: 'too late' }));
    const runner = new HookRunner({
      container,
      hooks: [hook({ event: 'tool.after', name: 'late' })],
      dialect,
    });
    const outcome = await runner.run({ event: 'tool.after', subject: 'edit_file' });
    assert.equal(outcome.blocked, undefined);
    assert.match(outcome.failures[0]?.detail ?? '', /nothing left to block/);
  });

  it('runs hooks in order and stops at the first block', async () => {
    const { container, calls } = fakeContainer((request) =>
      request.argv.join(' ').includes('second') ? { exitCode: 2, stderr: 'no' } : { exitCode: 0 },
    );
    const runner = new HookRunner({
      container,
      hooks: [
        hook({ command: 'first' }),
        hook({ command: 'second' }),
        hook({ command: 'third' }),
      ],
      dialect,
    });
    const outcome = await runner.run({ event: 'tool.before', subject: 'edit_file' });
    assert.ok(outcome.blocked);
    assert.equal(calls.length, 2, 'the third hook must not run after a block');
  });

  it('only runs the hooks whose pattern matches', async () => {
    const { container, calls } = fakeContainer(() => ({}));
    const runner = new HookRunner({
      container,
      hooks: [
        hook({ match: '^edit_file$', command: 'yes' }),
        hook({ match: '^run_command$', command: 'no' }),
      ],
      dialect,
    });
    await runner.run({ event: 'tool.before', subject: 'edit_file' });
    assert.equal(calls.length, 1);
    assert.match(calls[0]?.argv.join(' ') ?? '', /yes/);
  });

  it('caps hook stdout so a chatty hook cannot spend the context window', async () => {
    const { container } = fakeContainer(() => ({ exitCode: 0, stdout: 'x'.repeat(20_000) }));
    const runner = new HookRunner({ container, hooks: [hook()], dialect });
    const outcome = await runner.run({ event: 'tool.before', subject: 'edit_file' });
    assert.ok((outcome.context[0]?.length ?? 0) < 5_000);
    assert.match(outcome.context[0] ?? '', /truncated/);
  });

  it('reports a hook that could not be started as a failure, never a block', async () => {
    const container = {
      async exec(): Promise<ExecResult> {
        throw new Error('exec is not permitted');
      },
    } as unknown as Container;
    const runner = new HookRunner({ container, hooks: [hook({ name: 'lint' })], dialect });
    const outcome = await runner.run({ event: 'tool.before', subject: 'edit_file' });
    assert.equal(outcome.blocked, undefined);
    assert.deepEqual(outcome.failures, [{ hook: 'lint', detail: 'exec is not permitted' }]);
  });
});

describe('what the model is told', () => {
  it('says the action did not run, so the model does not retry it', () => {
    const text = describeHookOutcome({
      blocked: { hook: 'guard', reason: 'protected path' },
      context: [],
      failures: [],
    });
    assert.match(text, /Blocked by hook "guard": protected path/);
    assert.match(text, /did not run/);
  });

  it('passes advisory output through without dressing it up as a refusal', () => {
    const text = describeHookOutcome({ context: ['formatted 2 files'], failures: [] });
    assert.equal(text, 'formatted 2 files');
  });
});
