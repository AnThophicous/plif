import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EventBus } from '../src/events/bus.js';
import { ApprovalBroker } from '../src/policy/approval.js';
import { TaskManager } from '../src/tasks/manager.js';
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
