import { randomUUID } from 'node:crypto';

import { PlifError } from '../errors.js';
import type { EventBus } from '../events/bus.js';
import type { ApprovalBroker } from '../policy/approval.js';
import type { ExecRequest, ExecResult } from '../types.js';
import { classifyDangerousCommand } from './dangerous.js';

export type TaskStatus =
  | 'awaiting_approval'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'blocked';

export interface TaskSnapshot {
  readonly id: string;
  readonly title: string;
  readonly argv: readonly string[];
  readonly reason: string;
  readonly containerId: string;
  readonly status: TaskStatus;
  readonly createdAt: number;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error: string | null;
}

export interface TaskContainer {
  readonly id: string;
  readonly name: string;
  exec(request: ExecRequest): Promise<ExecResult>;
}

export interface StartTaskInput {
  readonly title: string;
  readonly argv: readonly string[];
  readonly reason: string;
}

type MutableTask = {
  -readonly [Key in keyof TaskSnapshot]: TaskSnapshot[Key];
} & {
  readonly controller: AbortController;
  promise: Promise<void> | null;
};

const OUTPUT_LIMIT = 16_000;

export class TaskManager {
  readonly container: TaskContainer;

  #bus: EventBus;
  #approvals: ApprovalBroker;
  #tasks = new Map<string, MutableTask>();

  constructor(options: { container: TaskContainer; bus: EventBus; approvals: ApprovalBroker }) {
    this.container = options.container;
    this.#bus = options.bus;
    this.#approvals = options.approvals;
  }

  async create(input: StartTaskInput): Promise<TaskSnapshot> {
    if (input.argv.length === 0 || input.argv.some((part) => !part.trim())) {
      throw new PlifError('INVALID_ARGUMENT', 'a task needs a non-empty argv');
    }
    if (!input.title.trim()) {
      throw new PlifError('INVALID_ARGUMENT', 'a task needs a title');
    }

    const task: MutableTask = {
      id: randomUUID().slice(0, 8),
      title: input.title.trim(),
      argv: [...input.argv],
      reason: input.reason.trim() || 'background work requested by the agent',
      containerId: this.container.id,
      status: 'awaiting_approval',
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      exitCode: null,
      stdout: '',
      stderr: '',
      error: null,
      controller: new AbortController(),
      promise: null,
    };
    this.#tasks.set(task.id, task);
    this.#bus.emit('task.created', {
      taskId: task.id,
      title: task.title,
      argv: task.argv,
      containerId: task.containerId,
    });

    const dangerous = classifyDangerousCommand(task.argv);
    if (dangerous) {
      this.#block(task, dangerous);
      return this.snapshot(task);
    }

    const answer = await this.#approvals.ask({
      containerId: task.containerId,
      action: 'exec',
      target: task.argv[0] as string,
      argv: task.argv,
      reason: task.reason,
      rationale: 'Background tasks always require explicit confirmation unless Auto Approve is enabled.',
    }, task.controller.signal);
    if (answer.decision !== 'allow') {
      this.#block(task, 'task approval was denied');
      return this.snapshot(task);
    }

    task.status = 'running';
    task.startedAt = Date.now();
    this.#bus.emit('task.started', { taskId: task.id, at: task.startedAt });
    task.promise = this.#run(task);
    return this.snapshot(task);
  }

  list(): TaskSnapshot[] {
    return [...this.#tasks.values()].map((task) => this.snapshot(task));
  }

  get(id: string): TaskSnapshot | null {
    const task = this.#tasks.get(id);
    return task ? this.snapshot(task) : null;
  }

  async cancel(id: string): Promise<TaskSnapshot | null> {
    const task = this.#tasks.get(id);
    if (!task) return null;
    if (task.status === 'awaiting_approval' || task.status === 'running') {
      task.controller.abort();
      if (task.status === 'awaiting_approval') {
        task.status = 'cancelled';
        task.endedAt = Date.now();
      }
    }
    if (task.promise) await task.promise;
    return this.snapshot(task);
  }

  async stopAll(): Promise<void> {
    const running = [...this.#tasks.values()].filter(
      (task) => task.status === 'awaiting_approval' || task.status === 'running',
    );
    for (const task of running) task.controller.abort();
    await Promise.allSettled(running.map((task) => task.promise).filter(Boolean) as Promise<void>[]);
    for (const task of running) {
      if (task.status === 'awaiting_approval') {
        task.status = 'cancelled';
        task.endedAt = Date.now();
      }
    }
  }

  #block(task: MutableTask, reason: string): void {
    task.status = 'blocked';
    task.error = reason;
    task.endedAt = Date.now();
    this.#bus.emit('task.blocked', { taskId: task.id, reason });
  }

  async #run(task: MutableTask): Promise<void> {
    let result: ExecResult;
    try {
      result = await this.container.exec({
        argv: task.argv,
        reason: task.reason,
        signal: task.controller.signal,
      });
    } catch (error) {
      task.status = task.controller.signal.aborted ? 'cancelled' : 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      task.endedAt = Date.now();
      this.#bus.emit('task.finished', {
        taskId: task.id,
        status: task.status,
        exitCode: -1,
        durationMs: task.endedAt - (task.startedAt ?? task.createdAt),
      });
      return;
    }

    task.stdout = clip(result.stdout);
    task.stderr = clip(result.stderr);
    if (task.stdout) this.#bus.emit('task.output', { taskId: task.id, stream: 'stdout', chunk: task.stdout });
    if (task.stderr) this.#bus.emit('task.output', { taskId: task.id, stream: 'stderr', chunk: task.stderr });
    task.exitCode = result.exitCode;
    task.status = task.controller.signal.aborted || result.killedBy === 'cancelled'
      ? 'cancelled'
      : result.exitCode === 0 && !result.killedBy
        ? 'done'
        : 'failed';
    task.endedAt = Date.now();
    this.#bus.emit('task.finished', {
      taskId: task.id,
      status: task.status,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    });
  }

  snapshot(task: MutableTask): TaskSnapshot {
    const { controller, promise, ...snapshot } = task;
    void controller;
    void promise;
    return { ...snapshot };
  }
}

function clip(value: string): string {
  if (value.length <= OUTPUT_LIMIT) return value;
  return value.slice(-OUTPUT_LIMIT);
}
