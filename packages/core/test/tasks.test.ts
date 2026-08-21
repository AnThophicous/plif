import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EventBus } from '../src/events/bus.js';
import { ApprovalBroker } from '../src/policy/approval.js';
import { TaskManager } from '../src/tasks/manager.js';
import { TaskMonitor } from '../src/tasks/monitor.js';
import type { ExecRequest, ExecResult } from '../src/types.js';

describe('TaskManager shell safety', () => {
  const blockedInvocations: readonly (readonly string[])[] = [
    ['rm', '-rf', './generated'],
    ['pwsh.exe', '-Command', 'Remove-Item ./generated -Recurse -Force'],
    ['pwsh.exe', '-Command', 'vssadmin delete shadows /all'],
    ['pwsh.exe', '-EncodedCommand', 'dmFsaWQ='],
  ];

  for (const argv of blockedInvocations) {
    it(`blocks ${argv.join(' ')} before approval or execution`, async () => {
      const bus = new EventBus();
      const approvals = new ApprovalBroker(bus);
      approvals.setAutoApprove(true);
      const requests: ExecRequest[] = [];
      const container = {
        id: 'task-test',
        name: 'task-test',
        async exec(request: ExecRequest): Promise<ExecResult> {
          requests.push(request);
          return {
            exitCode: 0,
            stdout: '',
            stderr: '',
            truncated: false,
            durationMs: 1,
          };
        },
      };
      const manager = new TaskManager({ container, bus, approvals });

      const task = await manager.create({
        title: 'unsafe background command',
        argv,
        reason: 'regression test',
      });

      assert.equal(task.status, 'blocked');
      assert.ok(task.error, 'blocked task should explain why it was refused');
      assert.equal(requests.length, 0);
    });
  }
});

describe('TaskMonitor', () => {
  it('wakes from a native event without polling repeatedly', async () => {
    const monitor = new TaskMonitor();
    let checks = 0;
    let wake: (() => void) | undefined;
    let unsubscribed = 0;
    const promise = monitor.watch({
      id: 'event-task',
      kind: 'test',
      sessionId: 'session-a',
      check: async () => checks++ === 0
        ? { state: 'unchanged' as const }
        : { state: 'completed' as const, result: 'ready' },
      subscribe: (notify) => {
        wake = notify;
        return () => { unsubscribed += 1; };
      },
    }, { initialPollMs: 100, maxPollMs: 100 });

    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    wake?.();
    const result = await promise;
    assert.equal(result.status, 'completed');
    assert.equal(result.result, 'ready');
    assert.equal(checks, 2);
    assert.equal(unsubscribed, 1, 'the event listener must be cleaned after the wakeup');
  });

  it('backs off deterministic fallback checks and never wakes the model itself', async () => {
    const monitor = new TaskMonitor();
    let checks = 0;
    const waits: number[] = [];
    const result = await monitor.watch({
      id: 'poll-task',
      kind: 'test',
      sessionId: 'session-a',
      check: async () => checks++ < 2
        ? { state: 'unchanged' as const }
        : { state: 'completed' as const, result: checks },
    }, {
      initialPollMs: 10,
      maxPollMs: 30,
      backoff: 2,
      wait: async (ms) => {
        waits.push(ms);
        return 'elapsed';
      },
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(waits, [10, 20]);
    assert.equal(checks, 3);
  });

  it('suppresses identical progress fingerprints before an actionable wakeup', async () => {
    const monitor = new TaskMonitor();
    let checks = 0;
    const actionable: string[] = [];
    const result = await monitor.watch({
      id: 'progress-task',
      kind: 'test',
      sessionId: 'session-a',
      check: async () => {
        checks += 1;
        return checks < 4
          ? { state: 'progress' as const, data: `step-${checks}`, fingerprint: checks < 3 ? 'same' : 'changed' }
          : { state: 'completed' as const, result: 'done' };
      },
    }, {
      wait: async () => 'elapsed',
      onProgress: (data) => {
        if (data) actionable.push(data);
        return actionable.length === 2;
      },
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(actionable, ['step-1', 'step-3']);
    assert.equal(checks, 3);
  });

  it('cancels the underlying work and cleans listeners', async () => {
    const monitor = new TaskMonitor();
    const controller = new AbortController();
    let cancelled = 0;
    let unsubscribed = 0;
    const promise = monitor.watch({
      id: 'cancel-task',
      kind: 'test',
      sessionId: 'session-a',
      check: async () => ({ state: 'unchanged' as const }),
      subscribe: () => () => { unsubscribed += 1; },
      cancel: () => { cancelled += 1; },
    }, { signal: controller.signal, initialPollMs: 100 });

    controller.abort();
    const result = await promise;
    assert.equal(result.status, 'cancelled');
    assert.equal(cancelled, 1);
    assert.equal(unsubscribed, 1);
    assert.equal(monitor.has('cancel-task'), false);
  });

  it('preserves an underlying task cancellation as cancellation', async () => {
    const monitor = new TaskMonitor();
    let wake: (() => void) | undefined;
    let checks = 0;
    const promise = monitor.watch({
      id: 'underlying-cancel-task',
      kind: 'test',
      sessionId: 'session-a',
      check: async () => checks++ === 0
        ? { state: 'unchanged' as const }
        : { state: 'cancelled' as const },
      subscribe: (notify) => {
        wake = notify;
        return () => undefined;
      },
    }, { initialPollMs: 100 });

    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    wake?.();
    const result = await promise;
    assert.equal(result.status, 'cancelled');
  });

  it('times out, cancels once, and keeps the session identity on the result', async () => {
    const monitor = new TaskMonitor();
    let now = 0;
    let cancelled = 0;
    const result = await monitor.watch({
      id: 'timeout-task',
      kind: 'test',
      sessionId: 'session-b',
      check: async () => ({ state: 'unchanged' as const }),
      cancel: () => { cancelled += 1; },
    }, {
      timeoutMs: 5,
      initialPollMs: 5,
      now: () => now,
      wait: async (ms) => {
        now += ms;
        return 'elapsed';
      },
    });

    assert.equal(result.status, 'timed_out');
    assert.equal(result.sessionId, 'session-b');
    assert.equal(cancelled, 1);
  });
});

describe('TaskManager waiting', () => {
  it('returns one terminal result from task-native completion events', async () => {
    const bus = new EventBus();
    const approvals = new ApprovalBroker(bus);
    approvals.setAutoApprove(true);
    const container = {
      id: 'wait-test',
      name: 'wait-test',
      async exec(_request: ExecRequest): Promise<ExecResult> {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        return { exitCode: 0, stdout: 'all good', stderr: '', truncated: false, durationMs: 10 };
      },
    };
    const manager = new TaskManager({ container, bus, approvals, sessionId: 'session-c' });
    const task = await manager.create({ title: 'wait for tests', argv: ['node', 'test'], reason: 'regression' });
    const result = await manager.waitFor(task.id);
    assert.equal(result?.status, 'completed');
    assert.equal(result?.sessionId, 'session-c');
    assert.equal(result?.result?.status, 'done');
    assert.equal(result?.result?.stdout, 'all good');
    await manager.stopAll();
  });
});
