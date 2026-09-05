import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PlifError } from '../errors.js';
import type { DebugFrame, DebugLauncher, DebugProcess, DebugStop, DebugValue } from './session.js';

const CONNECT_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 15_000;
const PAUSE_TIMEOUT_MS = 30_000;
const CONNECT_RETRY_MS = 100;

/**
 * Where the vendored debugpy lives, as a host path.
 *
 * It ships with plif rather than being installed per machine, for the same
 * reason the browser ships with Chromium: a debugger that only works when the
 * user already happened to install the right package is a debugger that mostly
 * does not work.
 */
export function vendoredPythonPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../vendor/python');
}

/** A free loopback port, taken and released so debugpy can bind it. */
async function freePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new PlifError('INTERNAL', 'no free port'))));
    });
  });
}

interface DapMessage {
  seq?: number;
  type?: string;
  command?: string;
  event?: string;
  request_seq?: number;
  success?: boolean;
  message?: string;
  body?: Record<string, unknown>;
}

/**
 * A debug session for languages whose runtime does not speak CDP.
 *
 * Same surface as the CDP session on purpose: the tool holds one or the other
 * and never asks which, because the difference between a Node breakpoint and a
 * Python one is not the model's problem.
 */
export class DapSession {
  readonly script: string;

  #process: DebugProcess | null = null;
  #socket: net.Socket | null = null;
  #buffer = Buffer.alloc(0);
  #seq = 1;
  #pending = new Map<number, { resolve: (body: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  #breakpoints = new Map<string, Set<number>>();
  #frames: DebugFrame[] = [];
  #threadId: number | null = null;
  #stopReason = 'launching';
  #running = false;
  #exited = false;
  #waiters = new Set<(reason: string) => void>();
  #printed = '';

  constructor(script: string) {
    this.script = script;
  }

  get exited(): boolean {
    return this.#exited;
  }

  get frames(): readonly DebugFrame[] {
    return this.#frames;
  }

  get stopReason(): string {
    return this.#stopReason;
  }

  async setBreakpoint(file: string, line: number): Promise<void> {
    const lines = this.#breakpoints.get(file) ?? new Set<number>();
    lines.add(line);
    this.#breakpoints.set(file, lines);
    if (this.#socket) await this.#armBreakpoints(file);
  }

  /**
   * Start the program stopped, wired to debugpy over loopback.
   *
   * --wait-for-client is the equivalent of Node's --inspect-brk: without it the
   * script races the debugger and usually wins, which looks to the caller like
   * breakpoints that do not work.
   */
  async launch(
    launcher: DebugLauncher,
    argv: readonly string[],
    cwd: string | undefined,
  ): Promise<DebugStop> {
    const port = await freePort();
    const started = await launcher.launch(
      [
        'python',
        '-m',
        'debugpy',
        '--listen',
        `127.0.0.1:${port}`,
        '--wait-for-client',
        this.script,
        ...argv,
      ],
      cwd,
      `debug ${this.script}`,
      { PYTHONPATH: vendoredPythonPath() },
    );
    this.#process = started;

    await this.#connect(port, started);
    await this.#request('initialize', {
      clientID: 'plif',
      adapterID: 'debugpy',
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: 'path',
      supportsRunInTerminalRequest: false,
    });
    // redirectOutput is what makes the program's own prints arrive as protocol
    // output events; without it they go to a pipe this client does not own.
    await this.#request('attach', {
      connect: { host: '127.0.0.1', port },
      redirectOutput: true,
    }).catch(() => ({}));

    for (const file of this.#breakpoints.keys()) await this.#armBreakpoints(file);
    await this.#request('configurationDone', {}).catch(() => ({}));

    // debugpy holds the program at its first line until configuration is done,
    // so the first stop is whatever the breakpoints say — there is no separate
    // "break on start" the way the Node inspector has.
    const stopped = this.#nextStop();
    return await stopped;
  }

  async resume(): Promise<DebugStop> {
    return await this.#move('continue');
  }

  async step(kind: 'over' | 'in' | 'out'): Promise<DebugStop> {
    return await this.#move(kind === 'in' ? 'stepIn' : kind === 'out' ? 'stepOut' : 'next');
  }

  async inspect(expression: string): Promise<string> {
    const frame = this.#frames[0];
    if (!frame) throw new PlifError('INVALID_ARGUMENT', 'the program is not stopped anywhere');

    const body = await this.#request('evaluate', {
      expression,
      frameId: Number(frame.id),
      context: 'repl',
    }).catch((error: unknown) => ({ result: `threw: ${String(error)}` }));
    return String((body as { result?: unknown }).result ?? 'None');
  }

  async locals(): Promise<DebugValue[]> {
    const frame = this.#frames[0];
    if (!frame) return [];

    const scopes = (await this.#request('scopes', { frameId: Number(frame.id) }).catch(() => ({}))) as {
      scopes?: { name?: string; variablesReference?: number; expensive?: boolean }[];
    };

    const out: DebugValue[] = [];
    const seen = new Set<string>();
    for (const scope of scopes.scopes ?? []) {
      // Globals are the interpreter's whole world; only the frame's own names
      // answer "what is going on here".
      if (scope.expensive || !scope.variablesReference) continue;
      const body = (await this.#request('variables', {
        variablesReference: scope.variablesReference,
      }).catch(() => ({}))) as {
        variables?: { name?: string; value?: string; presentationHint?: { kind?: string } }[];
      };

      for (const variable of body.variables ?? []) {
        // debugpy lists "special variables" and "function variables" as headings
        // for collapsible groups. They are furniture for a tree view, and in a
        // flat list they read as two locals with no value.
        if (variable.presentationHint?.kind === 'virtual') continue;
        if (variable.name === 'special variables' || variable.name === 'function variables') continue;
        if (!variable.name || seen.has(variable.name)) continue;
        seen.add(variable.name);
        out.push({ name: variable.name, value: variable.value ?? '' });
      }
    }
    return out;
  }

  async stop(): Promise<void> {
    this.#exited = true;
    for (const { reject } of this.#pending.values()) {
      reject(new PlifError('INTERNAL', 'the debug session ended'));
    }
    this.#pending.clear();
    await this.#request('disconnect', { terminateDebuggee: true }).catch(() => undefined);
    this.#socket?.destroy();
    this.#socket = null;
    await this.#process?.stop().catch(() => undefined);
    this.#process = null;
  }

  async #move(command: string): Promise<DebugStop> {
    if (this.#exited) return { reason: 'exited', frames: [], output: await this.#drain() };
    if (!this.#socket) throw new PlifError('INVALID_ARGUMENT', 'no program is being debugged');

    const stopped = this.#nextStop();
    await this.#request(command, { threadId: this.#threadId ?? 1 }).catch(() => {
      if (this.#exited) this.#settle('exited');
    });
    return await stopped;
  }

  async #nextStop(): Promise<DebugStop> {
    this.#running = true;
    const reason = await new Promise<string>((resolve) => {
      const waiter = (value: string): void => {
        clearTimeout(timer);
        this.#waiters.delete(waiter);
        resolve(value);
      };
      const timer = setTimeout(() => waiter('timeout'), PAUSE_TIMEOUT_MS);
      timer.unref?.();
      this.#waiters.add(waiter);
    });
    this.#running = false;
    return { reason, frames: this.#frames, output: await this.#drain() };
  }

  #settle(reason: string): void {
    this.#stopReason = reason;
    for (const waiter of [...this.#waiters]) waiter(reason);
  }

  /**
   * Read what the program has printed.
   *
   * A short wait once it has ended, because the exit event beats the pipe: the
   * last line the program printed is usually the one the caller wanted, and
   * reporting the run without it looks like the program printed nothing.
   */
  /**
   * Everything the program has printed since the last time this was asked.
   *
   * Two sources, because there are two: what debugpy forwards over the protocol,
   * and whatever the process wrote straight to its own pipe — the adapter's own
   * startup complaints, when it has any.
   */
  async #drain(): Promise<string> {
    const captured = this.#printed;
    this.#printed = '';
    const piped = (await this.#process?.output().catch(() => '')) ?? '';
    return captured + piped;
  }
  async #armBreakpoints(file: string): Promise<void> {
    const lines = [...(this.#breakpoints.get(file) ?? [])];
    await this.#request('setBreakpoints', {
      source: { path: file },
      breakpoints: lines.map((line) => ({ line })),
      lines,
    }).catch(() => undefined);
  }

  /**
   * Wait for debugpy to open its port, then keep the socket.
   *
   * Retried rather than attempted once: the interpreter has to start, import
   * debugpy and bind before anything can connect, and how long that takes is a
   * property of the machine rather than of the program being debugged.
   */
  async #connect(port: number, started: DebugProcess): Promise<void> {
    const deadline = Date.now() + CONNECT_TIMEOUT_MS;
    let output = '';
    while (Date.now() < deadline) {
      const socket = await new Promise<net.Socket | null>((resolve) => {
        const attempt = net.connect({ host: '127.0.0.1', port });
        attempt.once('connect', () => resolve(attempt));
        attempt.once('error', () => {
          attempt.destroy();
          resolve(null);
        });
      });

      if (socket) {
        socket.on('data', (chunk) => this.#receive(chunk));
        socket.on('close', () => {
          this.#exited = true;
          this.#frames = [];
          if (this.#running) this.#settle('exited');
        });
        this.#socket = socket;
        return;
      }

      output += await started.output().catch(() => '');
      await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_MS));
    }

    await started.stop().catch(() => undefined);
    throw new PlifError('INTERNAL', 'debugpy never opened its port', {
      detail: { output: output.slice(-2_000) },
      hint: 'Check that python is on PATH inside the container.',
    });
  }

  #receive(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      const header = this.#buffer.indexOf('\r\n\r\n');
      if (header < 0) return;

      const length = /Content-Length:\s*(\d+)/i.exec(this.#buffer.subarray(0, header).toString('utf8'));
      if (!length) {
        this.#buffer = this.#buffer.subarray(header + 4);
        continue;
      }
      const size = Number(length[1]);
      const start = header + 4;
      if (this.#buffer.length < start + size) return;

      const body = this.#buffer.subarray(start, start + size).toString('utf8');
      this.#buffer = this.#buffer.subarray(start + size);
      try {
        this.#dispatch(JSON.parse(body) as DapMessage);
      } catch {
        // A frame that is not JSON is not something this client can act on.
      }
    }
  }

  #dispatch(message: DapMessage): void {
    if (message.type === 'response') {
      const pending = message.request_seq === undefined ? undefined : this.#pending.get(message.request_seq);
      if (!pending || message.request_seq === undefined) return;
      this.#pending.delete(message.request_seq);
      if (message.success === false) {
        pending.reject(new PlifError('INTERNAL', message.message ?? `${message.command} failed`));
      } else {
        pending.resolve(message.body ?? {});
      }
      return;
    }
    if (message.type !== 'event') return;

    if (message.event === 'output') {
      // The debuggee's stdout arrives here rather than on its pipe: debugpy
      // captures it so that a program run under the debugger prints in the same
      // place whether it was launched by a terminal or attached to.
      const text = message.body?.['output'];
      if (typeof text === 'string') this.#printed += text;
      return;
    }

    if (message.event === 'stopped') {
      const body = message.body ?? {};
      this.#threadId = typeof body['threadId'] === 'number' ? body['threadId'] : this.#threadId;
      void this.#absorbStack(String(body['reason'] ?? 'paused'));
      return;
    }
    if (message.event === 'terminated' || message.event === 'exited') {
      this.#exited = true;
      this.#frames = [];
      if (this.#running) this.#settle('exited');
    }
  }

  /**
   * Frames come from a request, so the stop is announced only once they arrive.
   *
   * DAP reports "stopped" without saying where, unlike CDP which ships the call
   * frames with the pause. Settling before the stack is fetched would hand the
   * caller a stop with nothing in it.
   */
  async #absorbStack(reason: string): Promise<void> {
    const body = (await this.#request('stackTrace', {
      threadId: this.#threadId ?? 1,
      levels: 20,
    }).catch(() => ({}))) as {
      stackFrames?: { id?: number; name?: string; line?: number; source?: { path?: string } }[];
    };

    this.#frames = (body.stackFrames ?? []).map((frame) => ({
      id: String(frame.id ?? 0),
      name: frame.name || '(anonymous)',
      file: frame.source?.path ?? '(unknown)',
      line: frame.line ?? 0,
    }));
    this.#settle(reason);
  }

  async #request(command: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const socket = this.#socket;
    if (!socket) throw new PlifError('INVALID_ARGUMENT', 'no program is being debugged');

    const seq = this.#seq++;
    const answer = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(seq);
        reject(new PlifError('INTERNAL', `debugpy did not answer ${command}`));
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();
      this.#pending.set(seq, {
        resolve: (body) => {
          clearTimeout(timer);
          resolve(body);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });

    const payload = JSON.stringify({ seq, type: 'request', command, arguments: args });
    socket.write(`Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`);
    return await answer;
  }
}
