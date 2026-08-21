/**
 * Portable fallback backend — no OS-level confinement.
 *
 * This exists so Plif runs everywhere, not so it is safe everywhere. It
 * enforces timeouts, output ceilings and best-effort tree kills in userspace,
 * which contains *accidents* but not an adversary: a process here can write
 * anywhere the user can, open any socket, and outlive a hard crash of the CLI.
 *
 * It reports `isolation: 'none'`, and the core refuses to run anything above
 * the `trusted` trust tier on it. Do not "fix" that check.
 */

import { spawn as spawnProcess } from 'node:child_process';
import path from 'node:path';

import type {
  JailOptions,
  JailStats,
  SandboxBackend,
  SandboxCapabilityReport,
  SandboxJail,
  SpawnOptions,
  SpawnResult,
} from '../backend.js';
import { captureOutput } from '../output.js';
import { consoleDecoder, decoderDescription } from '../encoding.js';
import type { Decoder } from '../encoding.js';

class PortableJail implements SandboxJail {
  readonly id: string;
  readonly root: string;

  #live = new Set<ReturnType<typeof spawnProcess>>();
  #disposed = false;
  #peakMemory = 0;
  #totalProcesses = 0;
  #cpuMillis = 0;
  #maxProcesses: number;
  #decode: Decoder;

  constructor(options: JailOptions, decode: Decoder) {
    this.id = options.id;
    this.root = path.resolve(options.root);
    this.#maxProcesses = options.maxProcesses;
    this.#decode = decode;
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    if (this.#disposed) throw new Error(`jail ${this.id} is disposed`);
    if (this.#maxProcesses > 0 && this.#live.size >= this.#maxProcesses) {
      // The OS backends let the kernel refuse this; here we refuse ourselves so
      // the limit means the same thing on every platform.
      return {
        exitCode: 1,
        stdout: '',
        stderr: `plif: process limit of ${this.#maxProcesses} reached`,
        truncated: false,
        durationMs: 0,
        killedBy: 'processes',
      };
    }

    const [command, ...args] = options.argv;
    if (command === undefined) throw new Error('spawn requires at least one argv element');

    const started = Date.now();
    const child = spawnProcess(command, args, {
      cwd: options.cwd,
      env: { ...options.env },
      shell: false,
      windowsHide: true,
      // A detached group on POSIX lets us signal the whole tree with -pid.
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.#live.add(child);
    this.#totalProcesses += 1;

    let killedBy: SpawnResult['killedBy'];
    const { stdout, stderr, truncated } = captureOutput(
      child,
      options.maxOutputBytes,
      this.#decode,
      options.onOutput,
    );

    child.stdin?.end(options.stdin ?? '');

    const terminate = (reason: NonNullable<SpawnResult['killedBy']>) => {
      killedBy = reason;
      killTree(child);
    };
    const timer = setTimeout(() => terminate('timeout'), options.timeoutMs);
    const onAbort = () => terminate('cancelled');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const exitCode = await new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => {
          if (code !== null) resolve(code);
          else resolve(signal === 'SIGKILL' ? 137 : 143);
        });
      });
      this.#cpuMillis += Date.now() - started;
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
          stderr: `plif: command not found: ${command}`,
          truncated: false,
          durationMs: Date.now() - started,
        };
      }
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      this.#live.delete(child);
    }
  }

  async stats(): Promise<JailStats> {
    return {
      peakMemoryBytes: this.#peakMemory,
      activeProcesses: this.#live.size,
      totalProcesses: this.#totalProcesses,
      cpuMillis: this.#cpuMillis,
    };
  }

  async kill(_reason: string): Promise<void> {
    for (const child of this.#live) killTree(child);
    this.#live.clear();
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    await this.kill('dispose');
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }
}

function killTree(child: ReturnType<typeof spawnProcess>): void {
  if (child.pid === undefined || child.killed) return;
  if (process.platform === 'win32') {
    // Windows has no process groups for this; taskkill /T walks the tree.
    // Best effort: if it fails the direct kill below still gets the parent.
    try {
      spawnProcess('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch {
      // fall through to child.kill
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch {
      // fall through to child.kill
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // already gone
  }
}

export class PortableBackend implements SandboxBackend {
  readonly id = 'portable';

  async probe(): Promise<SandboxCapabilityReport> {
    // Resolve the decoder here so the report states the real encoding rather
    // than the pre-detection default.
    await consoleDecoder();
    return {
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
      degradations: [
        'No OS-level isolation. Timeouts, output ceilings and process counts are enforced in userspace and can be bypassed by the sandboxed process.',
        'Process-tree kills are best effort; a process that detaches itself survives.',
        'A hard crash of the CLI leaves sandboxed processes running.',
      ],
    };
  }

  async createJail(options: JailOptions): Promise<SandboxJail> {
    return new PortableJail(options, await consoleDecoder());
  }
}
