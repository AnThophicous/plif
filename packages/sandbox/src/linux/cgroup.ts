import { spawn as spawnProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { JailOptions, JailStats } from '../backend.js';

interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CgroupEvents {
  readonly oomKills: number;
  readonly processLimitHits: number;
}

export class SystemdCgroupJail {
  readonly unit: string;
  readonly root: string;
  readonly monitorRoot: string;

  #disposed = false;
  #userManager: boolean;
  #memoryBytes: number;
  #maxProcesses: number;
  #cpuCores: number;

  private constructor(
    unit: string,
    root: string,
    monitorRoot: string,
    options: JailOptions,
    userManager: boolean,
  ) {
    this.unit = unit;
    this.root = root;
    this.monitorRoot = monitorRoot;
    this.#userManager = userManager;
    this.#memoryBytes = options.memoryBytes;
    this.#maxProcesses = options.maxProcesses;
    this.#cpuCores = options.cpuCores;
  }

  static async create(options: JailOptions): Promise<SystemdCgroupJail> {
    const preferUser = typeof process.getuid === 'function' && process.getuid() !== 0;
    const modes = preferUser ? [true, false] : [false, true];
    let failure: unknown;
    for (const userManager of modes) {
      try {
        return await SystemdCgroupJail.createWithManager(options, userManager);
      } catch (error) {
        failure = error;
      }
    }
    throw failure instanceof Error ? failure : new Error(String(failure));
  }

  private static async createWithManager(
    options: JailOptions,
    userManager: boolean,
  ): Promise<SystemdCgroupJail> {
    const unit = `${sanitizeUnit(options.id)}-${randomUUID().slice(0, 8)}.service`;
    const quota = Math.max(1, Math.round(options.cpuCores * 100));
    const managerArgs = userManager ? ['--user'] : [];
    const result = await run('systemd-run', [
      ...managerArgs,
      `--unit=${unit}`,
      '--no-ask-password',
      '--quiet',
      '--collect',
      '--property=Type=simple',
      '--property=Delegate=yes',
      '--property=DelegateSubgroup=monitor',
      `--property=MemoryMax=${Math.max(1, options.memoryBytes)}`,
      '--property=MemorySwapMax=0',
      `--property=TasksMax=${Math.max(4, options.maxProcesses + 4)}`,
      `--property=CPUQuota=${quota}%`,
      '--property=KillMode=control-group',
      '/bin/sh',
      '-c',
      'while kill -0 "$1" 2>/dev/null; do sleep 1; done',
      'plif-monitor',
      String(process.pid),
    ]);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `systemd-run exited ${result.exitCode}`);
    }
    try {
      const shown = await run('systemctl', [
        ...managerArgs,
        'show',
        unit,
        '--property=ControlGroup',
        '--value',
      ]);
      if (shown.exitCode !== 0) throw new Error(shown.stderr.trim() || 'systemctl show failed');
      const relative = shown.stdout.trim();
      if (!relative.startsWith('/') || relative.includes('..')) {
        throw new Error(`invalid cgroup path: ${relative}`);
      }
      const root = path.resolve('/sys/fs/cgroup', `.${relative}`);
      await requireFiles(root, [
        'cgroup.kill',
        'cgroup.procs',
        'memory.max',
        'memory.peak',
        'memory.events',
        'pids.max',
        'pids.current',
        'pids.events',
        'cpu.max',
        'cpu.stat',
      ]);
      const monitorRoot = path.join(root, 'monitor');
      await fs.writeFile(path.join(root, 'cgroup.subtree_control'), '+cpu +memory +pids');
      await requireFiles(monitorRoot, ['pids.current']);
      return new SystemdCgroupJail(unit, root, monitorRoot, options, userManager);
    } catch (error) {
      await stopUnit(unit, userManager);
      throw error;
    }
  }

  async createExec(): Promise<string> {
    if (this.#disposed) throw new Error(`cgroup ${this.unit} is disposed`);
    const target = path.join(this.root, `exec-${randomUUID().slice(0, 12)}`);
    await fs.mkdir(target);
    await requireFiles(target, [
      'cgroup.kill',
      'cgroup.procs',
      'memory.events',
      'memory.max',
      'memory.swap.max',
      'pids.events',
      'pids.max',
      'cpu.max',
    ]);
    const period = 100_000;
    const quota = Math.max(1_000, Math.round(this.#cpuCores * period));
    await Promise.all([
      fs.writeFile(path.join(target, 'memory.max'), String(Math.max(1, this.#memoryBytes))),
      fs.writeFile(path.join(target, 'memory.swap.max'), '0'),
      fs.writeFile(path.join(target, 'pids.max'), String(Math.max(3, this.#maxProcesses + 2))),
      fs.writeFile(path.join(target, 'cpu.max'), `${quota} ${period}`),
    ]);
    return target;
  }

  launcher(execRoot: string, command: string, args: readonly string[]): readonly string[] {
    return [
      '-c',
      'printf "%s\n" "$$" > "$1/cgroup.procs" || exit 125; shift; exec "$@"',
      'plif-cgroup',
      execRoot,
      command,
      ...args,
    ];
  }

  async events(execRoot: string): Promise<CgroupEvents> {
    const [memory, pids] = await Promise.all([
      readKeyed(path.join(execRoot, 'memory.events')),
      readKeyed(path.join(execRoot, 'pids.events')),
    ]);
    return {
      oomKills: memory.get('oom_kill') ?? 0,
      processLimitHits: pids.get('max') ?? 0,
    };
  }

  async killExec(execRoot: string): Promise<void> {
    await fs.writeFile(path.join(execRoot, 'cgroup.kill'), '1').catch(() => undefined);
  }

  async releaseExec(execRoot: string): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        await fs.rmdir(execRoot);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        if ((error as NodeJS.ErrnoException).code !== 'EBUSY') throw error;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    throw new Error(`cgroup remained busy: ${execRoot}`);
  }

  async stats(totalProcesses: number): Promise<JailStats> {
    const [memory, active, monitor, cpu] = await Promise.all([
      readNumber(path.join(this.root, 'memory.peak')),
      readNumber(path.join(this.root, 'pids.current')),
      readNumber(path.join(this.monitorRoot, 'pids.current')),
      readKeyed(path.join(this.root, 'cpu.stat')),
    ]);
    return {
      peakMemoryBytes: memory,
      activeProcesses: Math.max(0, active - monitor),
      totalProcesses,
      cpuMillis: Math.floor((cpu.get('usage_usec') ?? 0) / 1000),
    };
  }

  async kill(): Promise<void> {
    await fs.writeFile(path.join(this.root, 'cgroup.kill'), '1').catch(() => undefined);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    await this.kill();
    await stopUnit(this.unit, this.#userManager);
  }
}

export async function probeSystemdCgroups(): Promise<boolean> {
  if (process.platform !== 'linux') return false;
  const options: JailOptions = {
    id: 'plif-cgroup-probe',
    root: '/',
    memoryBytes: 64 * 1024 * 1024,
    maxProcesses: 4,
    cpuCores: 1,
    writablePaths: [],
    allowNetwork: false,
    mounts: [],
  };
  let jail: SystemdCgroupJail | null = null;
  try {
    jail = await SystemdCgroupJail.create(options);
    const execRoot = await jail.createExec();
    await jail.releaseExec(execRoot);
    return true;
  } catch {
    return false;
  } finally {
    await jail?.dispose();
  }
}

function sanitizeUnit(value: string): string {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || 'plif';
}

async function requireFiles(root: string, names: readonly string[]): Promise<void> {
  for (const name of names) await fs.access(path.join(root, name));
}

async function readNumber(file: string): Promise<number> {
  const value = (await fs.readFile(file, 'utf8')).trim();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function readKeyed(file: string): Promise<Map<string, number>> {
  const values = new Map<string, number>();
  const text = await fs.readFile(file, 'utf8');
  for (const line of text.split('\n')) {
    const [key, raw] = line.trim().split(/\s+/, 2);
    if (!key || !raw) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) values.set(key, value);
  }
  return values;
}

async function stopUnit(unit: string, userManager: boolean): Promise<void> {
  const managerArgs = userManager ? ['--user'] : [];
  await run('systemctl', [...managerArgs, '--no-ask-password', 'stop', unit]);
  await run('systemctl', [...managerArgs, '--no-ask-password', 'reset-failed', unit]);
}

async function run(command: string, args: readonly string[]): Promise<CommandResult> {
  return await new Promise((resolve) => {
    const child = spawnProcess(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      resolve({ exitCode: 127, stdout, stderr: `${stderr}${error.message}` });
    });
    child.once('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}
