import { spawn as spawnProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  JailOptions,
  JailStats,
  SandboxBackend,
  SandboxCapabilityReport,
  SandboxJail,
  SandboxMount,
  SandboxTerminal,
  SpawnOptions,
  SpawnResult,
  TerminalOptions,
} from '../backend.js';
import { consoleDecoder, decoderDescription } from '../encoding.js';
import type { Decoder } from '../encoding.js';
import { captureOutput } from '../output.js';
import { PipeTerminal } from '../terminal.js';
import { probeSystemdCgroups, SystemdCgroupJail } from './cgroup.js';

interface PreparedMount extends SandboxMount {
  readonly source: string;
  readonly target: string;
  readonly masks: readonly PreparedMask[];
}

interface PreparedMask {
  readonly source: string;
  readonly target: string;
  readonly placeholder?: {
    readonly path: string;
    readonly dev: bigint;
    readonly ino: bigint;
    readonly ctimeNs: bigint;
    readonly directory: boolean;
  };
}

class LinuxJail implements SandboxJail {
  readonly id: string;
  readonly root: string;

  #options: JailOptions;
  #mounts: readonly PreparedMount[];
  #maskRoot: string;
  #decode: Decoder;
  #live = new Set<ReturnType<typeof spawnProcess>>();
  #execRoots = new Map<ReturnType<typeof spawnProcess>, string>();
  #cgroup: SystemdCgroupJail | null;
  #disposed = false;
  #totalProcesses = 0;
  #starting = 0;
  #startWaiters: Array<() => void> = [];
  #disposePromise: Promise<void> | undefined;

  constructor(
    options: JailOptions,
    mounts: readonly PreparedMount[],
    maskRoot: string,
    decode: Decoder,
    cgroup: SystemdCgroupJail | null,
  ) {
    this.id = options.id;
    this.root = path.resolve(options.root);
    this.#options = options;
    this.#mounts = mounts;
    this.#maskRoot = maskRoot;
    this.#decode = decode;
    this.#cgroup = cgroup;
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    if (this.#disposed) throw new Error(`jail ${this.id} is disposed`);
    if (options.signal?.aborted) {
      return {
        exitCode: 130,
        stdout: '',
        stderr: '',
        truncated: false,
        durationMs: 0,
        killedBy: 'cancelled',
      };
    }

    const command = options.argv[0];
    if (command === undefined) throw new Error('spawn requires at least one argv element');

    const started = Date.now();
    const sandboxArgs = this.#arguments(options);
    let execRoot: string | undefined;
    let child: ReturnType<typeof spawnProcess>;
    this.#starting += 1;
    try {
      execRoot = await this.#cgroup?.createExec();
      if (this.#disposed) throw new Error(`jail ${this.id} is disposed`);
      if (options.signal?.aborted) {
        if (execRoot) await this.#cgroup?.releaseExec(execRoot);
        execRoot = undefined;
        return {
          exitCode: 130,
          stdout: '',
          stderr: '',
          truncated: false,
          durationMs: Date.now() - started,
          killedBy: 'cancelled',
        };
      }
      const executable = execRoot ? '/bin/sh' : 'bwrap';
      const args = execRoot
        ? this.#cgroup?.launcher(execRoot, 'bwrap', sandboxArgs) ?? sandboxArgs
        : sandboxArgs;
      child = spawnProcess(executable, args, {
        cwd: this.root,
        env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' },
        shell: false,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.#live.add(child);
      if (execRoot) this.#execRoots.set(child, execRoot);
      this.#totalProcesses += 1;
    } catch (error) {
      if (execRoot) await this.#cgroup?.releaseExec(execRoot).catch(() => undefined);
      throw error;
    } finally {
      this.#starting -= 1;
      if (this.#starting === 0) {
        for (const resolve of this.#startWaiters.splice(0)) resolve();
      }
    }

    let killedBy: SpawnResult['killedBy'];
    const output = captureOutput(
      child,
      options.maxOutputBytes,
      this.#decode,
      options.onOutput,
    );
    child.stdin?.end(options.stdin ?? '');

    const terminate = (reason: NonNullable<SpawnResult['killedBy']>): void => {
      if (killedBy) return;
      killedBy = reason;
      if (execRoot) void this.#cgroup?.killExec(execRoot);
      killGroup(child);
    };
    const timer = setTimeout(() => terminate('timeout'), options.timeoutMs);
    const onAbort = (): void => terminate('cancelled');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const exitCode = await waitForExit(child);
      if (!killedBy && execRoot) {
        const events = await this.#cgroup?.events(execRoot);
        if ((events?.oomKills ?? 0) > 0) killedBy = 'memory';
        else if ((events?.processLimitHits ?? 0) > 0) killedBy = 'processes';
      }
      return {
        exitCode,
        stdout: output.stdout.text(),
        stderr: output.stderr.text(),
        truncated: output.truncated(),
        durationMs: Date.now() - started,
        ...(killedBy ? { killedBy } : {}),
      };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      this.#live.delete(child);
      this.#execRoots.delete(child);
      if (execRoot) await this.#cgroup?.releaseExec(execRoot);
    }
  }

  async openTerminal(options: TerminalOptions): Promise<SandboxTerminal> {
    if (this.#disposed) throw new Error('jail ' + this.id + ' is disposed');
    if (options.argv.length === 0) throw new Error('terminal requires at least one argv element');
    const sandboxArgs = this.#arguments(options);
    let execRoot: string | undefined;
    let child: ReturnType<typeof spawnProcess>;
    this.#starting += 1;
    try {
      execRoot = await this.#cgroup?.createExec();
      if (this.#disposed) throw new Error('jail ' + this.id + ' is disposed');
      const executable = execRoot ? '/bin/sh' : 'bwrap';
      const args = execRoot
        ? this.#cgroup?.launcher(execRoot, 'bwrap', sandboxArgs) ?? sandboxArgs
        : sandboxArgs;
      child = spawnProcess(executable, args, {
        cwd: this.root,
        env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' },
        shell: false,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.#live.add(child);
      if (execRoot) this.#execRoots.set(child, execRoot);
      this.#totalProcesses += 1;
    } catch (error) {
      if (execRoot) await this.#cgroup?.releaseExec(execRoot).catch(() => undefined);
      throw error;
    } finally {
      this.#starting -= 1;
      if (this.#starting === 0) {
        for (const resolve of this.#startWaiters.splice(0)) resolve();
      }
    }

    return new PipeTerminal(
      child,
      options,
      this.#decode,
      async () => {
        this.#live.delete(child);
        this.#execRoots.delete(child);
        if (execRoot) await this.#cgroup?.releaseExec(execRoot);
      },
      (signal) => killGroup(child, signal),
    );
  }

  async stats(): Promise<JailStats> {
    if (this.#cgroup) return await this.#cgroup.stats(this.#totalProcesses);
    return {
      peakMemoryBytes: 0,
      activeProcesses: this.#live.size,
      totalProcesses: this.#totalProcesses,
      cpuMillis: 0,
    };
  }

  async kill(_reason: string): Promise<void> {
    if (this.#starting > 0) {
      await new Promise<void>((resolve) => this.#startWaiters.push(resolve));
    }
    const live = [...this.#live];
    await Promise.allSettled(
      [...this.#execRoots.values()].map((execRoot) => this.#cgroup?.killExec(execRoot)),
    );
    for (const child of live) killGroup(child);
    await Promise.allSettled(live.map((child) => waitForClose(child)));
  }

  async dispose(): Promise<void> {
    if (!this.#disposePromise) {
      this.#disposed = true;
      this.#disposePromise = (async () => {
        await this.kill('dispose');
        await this.#cgroup?.dispose();
        await fs.rm(this.#maskRoot, { recursive: true, force: true });
        for (const mount of this.#mounts) {
          for (const mask of mount.masks) {
            if (!mask.placeholder) continue;
            const stat = await fs.lstat(mask.placeholder.path, { bigint: true }).catch(() => null);
            if (
              stat?.dev === mask.placeholder.dev
              && stat.ino === mask.placeholder.ino
              && stat.ctimeNs === mask.placeholder.ctimeNs
            ) {
              const empty = mask.placeholder.directory
                ? (await fs.readdir(mask.placeholder.path)).length === 0
                : stat.size === 0n;
              if (empty) {
                await fs.rm(mask.placeholder.path, {
                  force: true,
                  recursive: mask.placeholder.directory,
                });
              }
            }
          }
        }
      })();
    }
    await this.#disposePromise;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }

  #arguments(options: Pick<SpawnOptions, 'argv' | 'virtualCwd' | 'env'>): string[] {
    const args = [
      '--unshare-user',
      '--disable-userns',
      '--unshare-pid',
      '--unshare-ipc',
      '--unshare-uts',
      '--unshare-cgroup-try',
      '--die-with-parent',
      '--new-session',
      '--cap-drop',
      'ALL',
      '--bind',
      this.root,
      '/',
      '--ro-bind',
      '/usr',
      '/usr',
      '--symlink',
      'usr/bin',
      '/bin',
      '--symlink',
      'usr/lib',
      '/lib',
      '--symlink',
      'usr/lib64',
      '/lib64',
      '--symlink',
      'usr/sbin',
      '/sbin',
      '--proc',
      '/proc',
      '--dev',
      '/dev',
      '--tmpfs',
      '/etc',
    ];

    if (!this.#options.allowNetwork) args.push('--unshare-net');

    for (const source of systemFiles(this.#options.allowNetwork)) {
      args.push('--ro-bind-try', source, source);
    }

    for (const mount of this.#mounts) {
      args.push(mount.mode === 'rw' ? '--bind' : '--ro-bind', mount.source, mount.target);
      for (const mask of mount.masks) {
        args.push('--ro-bind', mask.source, mask.target);
      }
    }

    args.push('--chdir', options.virtualCwd, '--clearenv');
    for (const [key, raw] of Object.entries(options.env)) {
      const value = key === 'TEMP' || key === 'TMP' ? '/tmp' : raw;
      args.push('--setenv', key, value);
    }
    args.push('--', ...options.argv);
    return args;
  }
}

export class LinuxBackend implements SandboxBackend {
  readonly id = 'linux-bubblewrap';
  #report: Promise<SandboxCapabilityReport> | null = null;

  async probe(): Promise<SandboxCapabilityReport> {
    this.#report ??= probeBubblewrap(this.id);
    return await this.#report;
  }

  async createJail(options: JailOptions): Promise<SandboxJail> {
    const report = await this.probe();
    if (report.isolation === 'none') throw new Error(report.degradations[0] ?? 'bubblewrap unavailable');
    const root = await fs.realpath(options.root);
    const maskRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-masks-'));
    let cgroup: SystemdCgroupJail | null = null;
    try {
      const mounts = await prepareMounts(options.mounts, maskRoot);
      if (report.memoryLimit && report.processLimit && report.cpuLimit && report.accounting) {
        cgroup = await SystemdCgroupJail.create(options);
      }
      return new LinuxJail(
        { ...options, root },
        mounts,
        maskRoot,
        await consoleDecoder(),
        cgroup,
      );
    } catch (error) {
      await cgroup?.dispose();
      await fs.rm(maskRoot, { recursive: true, force: true });
      throw error;
    }
  }
}

async function probeBubblewrap(id: string): Promise<SandboxCapabilityReport> {
  await consoleDecoder();
  const unavailableCgroups = [
    'Memory limits require a delegated systemd cgroup v2 hierarchy.',
    'Process limits require a delegated systemd cgroup v2 hierarchy.',
    'CPU limits and resource accounting require a delegated systemd cgroup v2 hierarchy.',
  ];
  if (process.platform !== 'linux') {
    return unavailableReport(id, [`Platform is ${process.platform}, not linux.`, ...unavailableCgroups]);
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-bwrap-probe-'));
  try {
    await fs.mkdir(path.join(root, 'tmp'), { recursive: true });
    const child = spawnProcess(
      'bwrap',
      [
        '--unshare-user',
        '--disable-userns',
        '--unshare-pid',
        '--unshare-ipc',
        '--unshare-uts',
        '--unshare-net',
        '--die-with-parent',
        '--new-session',
        '--cap-drop',
        'ALL',
        '--bind',
        root,
        '/',
        '--ro-bind',
        '/usr',
        '/usr',
        '--symlink',
        'usr/bin',
        '/bin',
        '--symlink',
        'usr/lib',
        '/lib',
        '--symlink',
        'usr/lib64',
        '/lib64',
        '--symlink',
        'usr/sbin',
        '/sbin',
        '--proc',
        '/proc',
        '--dev',
        '/dev',
        '--',
        '/usr/bin/true',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    const exitCode = await waitForExit(child);
    if (exitCode !== 0) {
      return unavailableReport(id, [stderr.trim() || `bubblewrap probe exited ${exitCode}`, ...unavailableCgroups]);
    }
    const cgroups = await probeSystemdCgroups();
    const degradations = cgroups ? [] : unavailableCgroups;
    return {
      backend: id,
      platform: process.platform,
      isolation: 'namespace',
      killProcessTree: true,
      memoryLimit: cgroups,
      processLimit: cgroups,
      cpuLimit: cgroups,
      filesystemWriteBlock: true,
      networkBlock: true,
      accounting: cgroups,
      textEncoding: decoderDescription(),
      degradations,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return unavailableReport(id, [reason, ...unavailableCgroups]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function unavailableReport(id: string, degradations: readonly string[]): SandboxCapabilityReport {
  return {
    backend: id,
    platform: process.platform,
    isolation: 'none',
    killProcessTree: false,
    memoryLimit: false,
    processLimit: false,
    cpuLimit: false,
    filesystemWriteBlock: false,
    networkBlock: false,
    accounting: false,
    textEncoding: decoderDescription(),
    degradations,
  };
}

async function prepareMounts(
  mounts: readonly SandboxMount[],
  maskRoot: string,
): Promise<readonly PreparedMount[]> {
  const prepared: PreparedMount[] = [];
  const ordered = [...mounts].sort((left, right) => left.target.length - right.target.length);
  for (const [mountIndex, mount] of ordered.entries()) {
    const source = await fs.realpath(mount.source);
    const target = normalizeTarget(mount.target);
    const masks: PreparedMask[] = [];
    const expandedMasks = await expandMaskPatterns(source, mount.mask ?? []);
    for (const [maskIndex, rawMask] of expandedMasks.entries()) {
      const relative = normalizeTarget(rawMask.startsWith('/') ? rawMask : `/${rawMask}`);
      const parts = relative.split('/').filter(Boolean);
      let host = source;
      let maskedRelative = relative;
      let stat = await fs.lstat(host, { bigint: true });
      let placeholder: PreparedMask['placeholder'];
      for (const [partIndex, part] of parts.entries()) {
        host = path.join(host, part);
        const existing = await fs.lstat(host, { bigint: true }).catch(() => null);
        if (existing) {
          stat = existing;
          if (existing.isSymbolicLink() || !existing.isDirectory() && partIndex < parts.length - 1) {
            maskedRelative = `/${parts.slice(0, partIndex + 1).join('/')}`;
            break;
          }
          continue;
        }
        const directory = partIndex < parts.length - 1;
        maskedRelative = `/${parts.slice(0, partIndex + 1).join('/')}`;
        try {
          if (directory) await fs.mkdir(host);
          else await fs.writeFile(host, '', { flag: 'wx' });
          stat = await fs.lstat(host, { bigint: true });
          placeholder = {
            path: host,
            dev: stat.dev,
            ino: stat.ino,
            ctimeNs: stat.ctimeNs,
            directory,
          };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          stat = await fs.lstat(host, { bigint: true });
        }
        break;
      }
      const maskSource = path.join(maskRoot, `${mountIndex}-${maskIndex}`);
      if (stat?.isDirectory()) await fs.mkdir(maskSource, { recursive: true });
      else await fs.writeFile(maskSource, '');
      masks.push({
        source: maskSource,
        target: target === '/' ? maskedRelative : `${target}${maskedRelative}`,
        ...(placeholder ? { placeholder } : {}),
      });
    }
    prepared.push({ ...mount, source, target, masks });
  }
  return prepared;
}

async function expandMaskPatterns(source: string, masks: readonly string[]): Promise<string[]> {
  const exact = masks.filter((mask) => !mask.includes('*'));
  const patterns = masks.filter((mask) => mask.includes('*'));
  if (patterns.length === 0) return [...exact];

  const matchers = patterns.map((raw) => {
    const normalized = normalizeTarget(raw.startsWith('/') ? raw : `/${raw}`);
    const regex = normalized
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '(?:.*/)?')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*');
    return new RegExp(`^${regex}$`);
  });
  const matches = new Set<string>();
  const pending: Array<{ host: string; relative: string }> = [{ host: source, relative: '' }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    const entries = await fs.readdir(current.host, { withFileTypes: true });
    for (const entry of entries) {
      const relative = `${current.relative}/${entry.name}`;
      if (matchers.some((matcher) => matcher.test(relative))) matches.add(relative);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        pending.push({ host: path.join(current.host, entry.name), relative });
      }
    }
  }
  return [...exact, ...matches];
}

function normalizeTarget(input: string): string {
  if (!input.startsWith('/')) throw new Error(`sandbox target must be absolute: ${input}`);
  const output: string[] = [];
  for (const part of input.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') throw new Error(`sandbox target escapes root: ${input}`);
    output.push(part);
  }
  return `/${output.join('/')}`;
}

function systemFiles(network: boolean): string[] {
  const files = ['/etc/localtime', '/etc/passwd', '/etc/group'];
  if (network) {
    files.push(
      '/etc/hosts',
      '/etc/resolv.conf',
      '/etc/nsswitch.conf',
      '/etc/gai.conf',
      '/etc/ssl',
      '/etc/ca-certificates',
    );
  }
  return files;
}

function killGroup(child: ReturnType<typeof spawnProcess>, signal: NodeJS.Signals = 'SIGKILL'): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

function waitForExit(child: ReturnType<typeof spawnProcess>): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      child.removeListener('close', onClose);
      reject(error);
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
      child.removeListener('error', onError);
      if (code !== null) resolve(code);
      else resolve(signal === 'SIGKILL' ? 137 : 143);
    };
    child.once('error', onError);
    child.once('close', onClose);
    if (child.exitCode !== null || child.signalCode !== null) {
      child.removeListener('error', onError);
      child.removeListener('close', onClose);
      if (child.exitCode !== null) resolve(child.exitCode);
      else resolve(child.signalCode === 'SIGKILL' ? 137 : 143);
    }
  });
}

function waitForClose(child: ReturnType<typeof spawnProcess>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const onClose = (): void => resolve();
    child.once('close', onClose);
    if (child.exitCode !== null || child.signalCode !== null) {
      child.removeListener('close', onClose);
      resolve();
    }
  });
}
