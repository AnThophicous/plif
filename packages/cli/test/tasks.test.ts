import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TaskSnapshot } from '@plif/core';
import { visibleTasks } from '../src/components/TaskIndicator.js';

const task = (status: TaskSnapshot['status']): TaskSnapshot => ({
  id: status, title: status, argv: ['x'], reason: 'test', containerId: 'c', status,
  createdAt: 1, startedAt: null, endedAt: null, exitCode: null, stdout: '', stderr: '', error: null,
});

describe('task chrome lifecycle', () => {
  it('keeps only work that can still change', () => {
    assert.deepEqual(
      visibleTasks(['awaiting_approval', 'running', 'done', 'failed', 'blocked', 'cancelled'].map((status) => task(status as TaskSnapshot['status']))).map((item) => item.status),
      ['awaiting_approval', 'running'],
    );
  });
});
