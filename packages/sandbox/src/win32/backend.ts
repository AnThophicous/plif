/**
 * Windows sandbox backend: Job Object confinement.
 *
 * Design notes, and the reasoning behind what is *not* here:
 *
 * - **AppContainer was considered and rejected.** It gives stronger isolation
 *   but is deny-by-default on the filesystem, and a coding agent legitimately
 *   needs to read the repository, the toolchain, git config and dependency
 *   caches. Retrofitting grants for all of that reproduces the host ACL set
 *   with extra steps. This mirrors the conclusion OpenAI reached for the Codex
 *   Windows sandbox.
 * - **Job Objects are the enforcement spine.** They give an atomic,
 *   crash-proof kill of the whole process tree plus kernel-enforced memory,
 *   process-count and CPU ceilings. That covers runaway and fork-bomb
 *   behaviour, which is the realistic failure mode of an agent loop.
 * - **Write confinement is currently path-based**, done by the core's jail
 *   above this layer, not by a restricted token. The capability report says so
 *   honestly via `filesystemWriteBlock: false`. Restricted tokens are the next
 *   increment and slot in behind this same interface.
 */

import { spawn as spawnProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import type {
  JailOptions,
  JailStats,
  SandboxBackend,
  SandboxCapabilityReport,
  SandboxJail,
  SandboxTerminal,
  SpawnOptions,
  SpawnResult,
  TerminalOptions,
} from '../backend.js';
import {
  ACCOUNTING_SIZE,
  BASIC_LIMIT_SIZE,
  EXTENDED_LIMIT_SIZE,
  JOB_OBJECT_CPU_RATE_CONTROL_ENABLE,
  JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP,
  JOB_OBJECT_LIMIT_ACTIVE_PROCESS,
  JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
  JOB_OBJECT_LIMIT_JOB_MEMORY,
  JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
  JobObjectBasicAccountingInformation,
  JobObjectBasicUIRestrictions,
  JobObjectCpuRateControlInformation,
  JobObjectExtendedLimitInformation,
  OFF_ACTIVE_PROCESS_LIMIT,
  OFF_ACTIVE_PROCESSES,
  OFF_JOB_MEMORY_LIMIT,
  OFF_LIMIT_FLAGS,
  OFF_PEAK_JOB_MEMORY,
  OFF_TOTAL_KERNEL_TIME,
  OFF_TOTAL_PROCESSES,
  OFF_TOTAL_USER_TIME,
  PROCESS_QUERY_INFORMATION,
  PROCESS_SET_QUOTA,
  PROCESS_TERMINATE,
  UI_RESTRICTIONS_ALL,
  loadWin32,
  ticksToMillis,
  win32LoadError,
} from './ffi.js';
import type { Win32Bindings } from './ffi.js';
import { captureOutput } from '../output.js';
import { PipeTerminal } from '../terminal.js';
import { consoleDecoder, decoderDescription } from '../encoding.js';
import type { Decoder } from '../encoding.js';

const CPU_RATE_SCALE = 10_000; // 1/100th of a percent; 10000 == one full core.

class Win32Jail implements SandboxJail {
  readonly id: string;
  readonly root: string;

  #bindings: Win32Bindings;
  #job: unknown;
  #options: JailOptions;
  #decode: Decoder;
  #disposed = false;
  #killReason: string | undefined;
  /** Peak memory sampled before termination, since the job vanishes on kill. */
  #lastStats: JailStats = {
    peakMemoryBytes: 0,
    activeProcesses: 0,
    totalProcesses: 0,
    cpuMillis: 0,
  };

  constructor(bindings: Win32Bindings, job: unknown, options: JailOptions, decode: Decoder) {
    this.#bindings = bindings;
    this.#job = job;
    this.#options = options;
    this.#decode = decode;
    this.id = options.id;
    this.root = options.root;
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    if (this.#disposed) {
      throw new Error(`jail ${this.id} is disposed`);
    }
    const [command, ...args] = options.argv;
    if (command === undefined) {
      throw new Error('spawn requires at least one argv element');
    }

    const started = Date.now();
    const child = spawnProcess(command, args, {
      cwd: options.cwd,
      env: { ...options.env },
      windowsHide: true,
      // Never use shell:true — it would let argv metacharacters compose new
      // commands, which defeats the point of an argv-based tool contract.
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Assign to the job as early as possible. There is an unavoidable window
    // between CreateProcess and this call during which a child could spawn a
    // grandchild that escapes the job. Node cannot create suspended processes,
    // so the window is minimised rather than eliminated; the capability report
    // does not claim otherwise. A launcher stub that self-assigns before exec
    // is the fix, and is tracked as future work.
    let assigned = false;
    if (typeof child.pid === 'number') {
      assigned = this.#assign(child.pid);
    }

    return await this.#collect(child, options, started, assigned);
  }

  async openTerminal(options: TerminalOptions): Promise<SandboxTerminal> {
    if (this.#disposed) throw new Error('jail ' + this.id + ' is disposed');
    const [command, ...args] = options.argv;
    if (command === undefined) throw new Error('terminal requires at least one argv element');
    const child = spawnProcess(command, args, {
      cwd: options.cwd,
      env: { ...options.env },
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const assigned = typeof child.pid === 'number' ? this.#assign(child.pid) : false;
    return new PipeTerminal(child, options, this.#decode, undefined, (signal) => {
      if (assigned) {
        if (signal === 'SIGKILL') {
          void this.kill('terminal signal');
        } else {
          child.kill(signal);
        }
        return;
      }
      child.kill(signal);
    });
  }

  #assign(pid: number): boolean {
    const { kernel32 } = this.#bindings;
    const handle = kernel32.OpenProcess(
      PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_INFORMATION,
      0,
      pid,
    );
    if (!handle) return false;
    try {
      return kernel32.AssignProcessToJobObject(this.#job, handle) !== 0;
    } finally {
      kernel32.CloseHandle(handle);
    }
  }

  async #collect(
    child: ReturnType<typeof spawnProcess>,
    options: SpawnOptions,
    started: number,
    assigned: boolean,
  ): Promise<SpawnResult> {
    const { stdout, stderr, truncated } = captureOutput(
      child,
      options.maxOutputBytes,
      this.#decode,
      options.onOutput,
    );

    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    } else {
      // Close stdin so a process that reads it sees EOF instead of hanging
      // until the timeout — a very common way for agent execs to waste a slot.
      child.stdin?.end();
    }

    let killedBy: SpawnResult['killedBy'];

    const terminate = async (reason: NonNullable<SpawnResult['killedBy']>) => {
      killedBy = reason;
      // Kill through the job, not the pid: this reaps grandchildren too.
      // Fall back to the pid only if the job never took the process.
      if (assigned) {
        await this.kill(reason);
      } else {
        child.kill('SIGKILL');
      }
    };

    const timer = setTimeout(() => void terminate('timeout'), options.timeoutMs);
    const onAbort = () => void terminate('cancelled');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const exitCode = await new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => {
          if (code !== null) resolve(code);
          // Killed by signal: report the conventional 128+n so callers can tell
          // a clean non-zero exit from a violent one.
          else resolve(signal === 'SIGKILL' ? 137 : 143);
        });
      });

      return {
        exitCode,
        stdout: stdout.text(),
        stderr: stderr.text(),
        truncated: truncated(),
        durationMs: Date.now() - started,
        ...(killedBy ? { killedBy } : {}),
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return {
          exitCode: 127,
          stdout: '',
          stderr: `plif: command not found: ${options.argv[0] ?? '(empty command)'}`,
          truncated: false,
          durationMs: Date.now() - started,
        };
      }
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  async stats(): Promise<JailStats> {
    if (this.#disposed) return this.#lastStats;
    const { kernel32, koffi } = this.#bindings;

    const accounting = Buffer.alloc(ACCOUNTING_SIZE);
    const extended = Buffer.alloc(EXTENDED_LIMIT_SIZE);

    const okAcct =
      kernel32.QueryInformationJobObject(
        this.#job,
        JobObjectBasicAccountingInformation,
        accounting,
        ACCOUNTING_SIZE,
        null,
      ) !== 0;
    const okExt =
      kernel32.QueryInformationJobObject(
        this.#job,
        JobObjectExtendedLimitInformation,
        extended,
        EXTENDED_LIMIT_SIZE,
        null,
      ) !== 0;
    void koffi;

    if (!okAcct && !okExt) return this.#lastStats;

    const userTime = accounting.readBigUInt64LE(OFF_TOTAL_USER_TIME);
    const kernelTime = accounting.readBigUInt64LE(OFF_TOTAL_KERNEL_TIME);

    this.#lastStats = {
      peakMemoryBytes: okExt ? Number(extended.readBigUInt64LE(OFF_PEAK_JOB_MEMORY)) : 0,
      activeProcesses: okAcct ? accounting.readUInt32LE(OFF_ACTIVE_PROCESSES) : 0,
      totalProcesses: okAcct ? accounting.readUInt32LE(OFF_TOTAL_PROCESSES) : 0,
      cpuMillis: okAcct ? ticksToMillis(userTime + kernelTime) : 0,
    };
    return this.#lastStats;
  }

  async kill(reason: string): Promise<void> {
    if (this.#disposed) return;
    this.#killReason = reason;
    // Snapshot usage first — after TerminateJobObject the counters are gone and
    // the CLI would show a zeroed meter for the run that just died.
    await this.stats().catch(() => undefined);
    this.#bindings.kernel32.TerminateJobObject(this.#job, 1);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    await this.stats().catch(() => undefined);
    this.#disposed = true;
    // KILL_ON_JOB_CLOSE means closing the last handle terminates the tree, so
    // this single call is both the resource release and the safety net.
    this.#bindings.kernel32.CloseHandle(this.#job);
    this.#job = null;
    void this.#killReason;
    void this.#options;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }
}

export class Win32Backend implements SandboxBackend {
  readonly id = 'win32-job';
  #report: SandboxCapabilityReport | undefined;

  async probe(): Promise<SandboxCapabilityReport> {
    if (this.#report) return this.#report;

    const bindings = await loadWin32();
    // Resolve the decoder during probe so the report can state the encoding
    // rather than leaving it at the pre-detection default.
    await consoleDecoder();
    const degradations: string[] = [];

    if (!bindings) {
      degradations.push(
        `Job Object bindings unavailable: ${win32LoadError() ?? 'unknown reason'}`,
      );
      this.#report = {
        backend: this.id,
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
      return this.#report;
    }

    degradations.push(
      'Filesystem writes are confined by path checks in the core jail, not by a restricted token — a process that resolves a path the jail did not vet can still write to it.',
    );
    // Observed, not theoretical: an agent denied `write_file` by capability
    // immediately re-tried with `run_command ["node","-e","fs.writeFileSync..."]`
    // and succeeded. Worth stating separately, because a reader can see
    // "fs write block: not enforced" without connecting it to "a denied write
    // tool is advisory as soon as exec is granted".
    degradations.push(
      'Because writes are not blocked at the OS level, a spawned process can write anywhere you can — so granting exec while withholding hostWrite does NOT prevent the agent from editing host files; it only makes it take a detour.',
    );
    degradations.push(
      'Outbound network is not blocked at the OS level; the policy layer gates it per host.',
    );
    degradations.push(
      'A grandchild spawned in the few milliseconds before job assignment can escape the job.',
    );

    this.#report = {
      backend: this.id,
      platform: process.platform,
      isolation: 'job',
      killProcessTree: true,
      memoryLimit: true,
      processLimit: true,
      cpuLimit: true,
      filesystemWriteBlock: false,
      networkBlock: false,
      accounting: true,
      textEncoding: decoderDescription(),
      degradations,
    };
    return this.#report;
  }

  async createJail(options: JailOptions): Promise<SandboxJail> {
    const bindings = await loadWin32();
    if (!bindings) {
      throw new Error(`win32 sandbox unavailable: ${win32LoadError() ?? 'unknown reason'}`);
    }
    const { kernel32 } = bindings;

    // Unnamed job: an anonymous kernel object cannot be opened by name from
    // another process, so a sandboxed child cannot find and manipulate it.
    const job = kernel32.CreateJobObjectW(null, null);
    if (!job) {
      throw new Error(`CreateJobObject failed (GetLastError=${kernel32.GetLastError()})`);
    }

    try {
      applyExtendedLimits(bindings, job, options);
      applyUiRestrictions(bindings, job);
      applyCpuRate(bindings, job, options);
    } catch (error) {
      kernel32.CloseHandle(job);
      throw error;
    }

    return new Win32Jail(
      bindings,
      job,
      { ...options, root: path.resolve(options.root) },
      await consoleDecoder(),
    );
  }
}

function applyExtendedLimits(bindings: Win32Bindings, job: unknown, options: JailOptions): void {
  const { kernel32 } = bindings;
  const info = Buffer.alloc(EXTENDED_LIMIT_SIZE);

  let flags =
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;

  if (options.maxProcesses > 0) {
    flags |= JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
    info.writeUInt32LE(options.maxProcesses, OFF_ACTIVE_PROCESS_LIMIT);
  }
  if (options.memoryBytes > 0) {
    flags |= JOB_OBJECT_LIMIT_JOB_MEMORY;
    info.writeBigUInt64LE(BigInt(options.memoryBytes), OFF_JOB_MEMORY_LIMIT);
  }
  info.writeUInt32LE(flags, OFF_LIMIT_FLAGS);

  if (
    kernel32.SetInformationJobObject(
      job,
      JobObjectExtendedLimitInformation,
      info,
      EXTENDED_LIMIT_SIZE,
    ) === 0
  ) {
    throw new Error(
      `SetInformationJobObject(ExtendedLimit) failed (GetLastError=${kernel32.GetLastError()})`,
    );
  }
  void BASIC_LIMIT_SIZE;
}

function applyUiRestrictions(bindings: Win32Bindings, job: unknown): void {
  const { kernel32 } = bindings;
  const info = Buffer.alloc(4);
  info.writeUInt32LE(UI_RESTRICTIONS_ALL, 0);
  // Non-fatal: UI restrictions are hardening, not the primary boundary. On some
  // session configurations this fails and the job is still worth having.
  kernel32.SetInformationJobObject(job, JobObjectBasicUIRestrictions, info, 4);
}

function applyCpuRate(bindings: Win32Bindings, job: unknown, options: JailOptions): void {
  if (options.cpuCores <= 0) return;
  const { kernel32 } = bindings;

  const cores = Math.max(1, os.availableParallelism());
  const rate = Math.min(
    CPU_RATE_SCALE,
    Math.max(1, Math.round((options.cpuCores / cores) * CPU_RATE_SCALE)),
  );
  if (rate >= CPU_RATE_SCALE) return; // Asking for every core is no cap at all.

  const info = Buffer.alloc(8);
  info.writeUInt32LE(JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP, 0);
  info.writeUInt32LE(rate, 4);
  kernel32.SetInformationJobObject(job, JobObjectCpuRateControlInformation, info, 8);
}
