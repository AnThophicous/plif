import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';

import type {
  SandboxTerminal,
  SpawnResult,
  TerminalOptions,
  TerminalOutput,
  TerminalSignal,
} from './backend.js';
import { BoundedBuffer } from './output.js';
import type { Decoder } from './encoding.js';

interface TerminalCleanup {
  (): void | Promise<void>;
}

interface TerminalTerminate {
  (signal: TerminalSignal): void;
}

export class PipeTerminal implements SandboxTerminal {
  readonly id = randomUUID();
  readonly ownerId: string | undefined;
  readonly sessionId: string | undefined;
  readonly containerId: string | undefined;

  #child: ChildProcess;
  #decode: Decoder;
  #stdout: BoundedBuffer;
  #stderr: BoundedBuffer;
  #chunks: TerminalOutput[] = [];
  #waiters: Array<(output: IteratorResult<TerminalOutput>) => void> = [];
  #done: Promise<SpawnResult>;
  #resolveDone!: (result: SpawnResult) => void;
  #started = Date.now();
  #closed = false;
  #result: SpawnResult | undefined;
  #cleanup: TerminalCleanup;
  #terminate: TerminalTerminate;

  constructor(
    child: ChildProcess,
    options: TerminalOptions,
    decode: Decoder,
    cleanup: TerminalCleanup = () => undefined,
    terminate: TerminalTerminate = (signal) => {
      child.kill(signal);
    },
  ) {
    this.#child = child;
    this.#decode = decode;
    this.#stdout = new BoundedBuffer(options.maxOutputBytes, decode);
    this.#stderr = new BoundedBuffer(options.maxOutputBytes, decode);
    this.ownerId = options.ownerId;
    this.sessionId = options.sessionId;
    this.containerId = options.containerId;
    this.#cleanup = cleanup;
    this.#terminate = terminate;
    this.#done = new Promise<SpawnResult>((resolve) => {
      this.#resolveDone = resolve;
    });

    child.stdout?.on('data', (chunk: Buffer) => this.#push('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => this.#push('stderr', chunk));
    child.once('error', (error: NodeJS.ErrnoException) => {
      if (this.#result) return;
      this.#finish({
        exitCode: error.code === 'ENOENT' ? 127 : 1,
        stdout: this.#stdout.text(),
        stderr: error.code === 'ENOENT' ? 'plif: command not found' : error.message,
        truncated: this.#stdout.truncated || this.#stderr.truncated,
        durationMs: Date.now() - this.#started,
      });
    });
    child.once('close', (code, signal) => {
      if (this.#result) return;
      this.#finish({
        exitCode: code ?? (signal === 'SIGKILL' ? 137 : 143),
        stdout: this.#stdout.text(),
        stderr: this.#stderr.text(),
        truncated: this.#stdout.truncated || this.#stderr.truncated,
        durationMs: Date.now() - this.#started,
      });
    });
  }

  async write(input: string): Promise<void> {
    if (this.#closed || this.#result) throw new Error('terminal ' + this.id + ' is not running');
    const stdin = this.#child.stdin;
    if (!stdin || !stdin.writable) throw new Error('terminal ' + this.id + ' stdin is closed');
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (error?: Error | null): void => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };
      const ok = stdin.write(input, 'utf8', (error?: Error | null) => done(error));
      if (!ok) stdin.once('drain', () => done());
    });
  }

  async readAvailable(): Promise<readonly TerminalOutput[]> {
    return this.#chunks.splice(0);
  }

  async *read(): AsyncGenerator<TerminalOutput> {
    while (true) {
      const next = await this.#next();
      if (next.done) return;
      yield next.value;
    }
  }

  async resize(columns: number, rows: number): Promise<void> {
    if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) {
      throw new Error('terminal size must use positive integer columns and rows');
    }
  }

  async signal(signal: TerminalSignal): Promise<void> {
    if (this.#result) return;
    if (this.#child.pid === undefined) return;
    try {
      this.#terminate(signal);
    } catch {
      await this.close();
    }
  }

  wait(): Promise<SpawnResult> {
    return this.#done;
  }

  async close(): Promise<void> {
    if (this.#result) return;
    this.#closed = true;
    try {
      if (this.#child.pid !== undefined) this.#terminate('SIGTERM');
    } catch {
      return;
    }
    await this.#done;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  #push(stream: 'stdout' | 'stderr', chunk: Buffer): void {
    const buffer = stream === 'stdout' ? this.#stdout : this.#stderr;
    const kept = buffer.push(chunk);
    if (kept.length === 0) return;
    const output: TerminalOutput = { stream, chunk: this.#decode(kept), at: Date.now() };
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ done: false, value: output });
    else this.#chunks.push(output);
  }

  async #next(): Promise<IteratorResult<TerminalOutput>> {
    const buffered = this.#chunks.shift();
    if (buffered) return { done: false, value: buffered };
    if (this.#result) return { done: true, value: undefined };
    return new Promise<IteratorResult<TerminalOutput>>((resolve) => this.#waiters.push(resolve));
  }

  #finish(result: SpawnResult): void {
    if (this.#result) return;
    this.#result = result;
    this.#resolveDone(result);
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined });
    void Promise.resolve(this.#cleanup()).catch(() => undefined);
  }
}
