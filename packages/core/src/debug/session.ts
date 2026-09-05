import { pathToFileURL } from 'node:url';

import { PlifError } from '../errors.js';

/**
 * A debuggee, however it was started.
 *
 * The session does not know whether the process lives in the container's jail or
 * in a test harness, and must not: everything it needs is the inspector URL the
 * runtime prints and a way to stop the process again.
 */
export interface DebugProcess {
  /** Output produced since the last call, both streams interleaved. */
  output(): Promise<string>;
  stop(): Promise<void>;
}

export interface DebugLauncher {
  launch(
    argv: readonly string[],
    cwd: string | undefined,
    reason: string,
    /** Extra variables the debuggee needs, such as where a vendored adapter lives. */
    env?: Readonly<Record<string, string>>,
  ): Promise<DebugProcess>;
}

/**
 * What the debug tool needs from a session, whichever protocol it speaks.
 *
 * The Node session talks CDP and the Python one talks DAP, and the tool holds
 * one or the other without asking which: the difference between a breakpoint in
 * one language and a breakpoint in another is not the model's problem.
 */
export interface DebuggerBackend {
  readonly script: string;
  readonly exited: boolean;
  readonly frames: readonly DebugFrame[];
  readonly stopReason: string;
  setBreakpoint(file: string, line: number): Promise<void>;
  launch(
    launcher: DebugLauncher,
    argv: readonly string[],
    cwd: string | undefined,
  ): Promise<DebugStop>;
  resume(): Promise<DebugStop>;
  step(kind: 'over' | 'in' | 'out'): Promise<DebugStop>;
  inspect(expression: string): Promise<string>;
  locals(): Promise<DebugValue[]>;
  stop(): Promise<void>;
}

export interface DebugFrame {
  readonly id: string;
  readonly name: string;
  readonly file: string;
  readonly line: number;
}

export interface DebugStop {
  /** 'breakpoint', 'step', 'exception', or 'exited' when the program finished. */
  readonly reason: string;
  readonly frames: readonly DebugFrame[];
  readonly output: string;
}

export interface DebugValue {
  readonly name: string;
  readonly value: string;
}

const CONNECT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;
const PAUSE_TIMEOUT_MS = 30_000;
const URL_POLL_MS = 100;

/** Node prints this once, on stderr, before it stops at the first line. */
const INSPECTOR_URL = /ws:\/\/[^\s]+/;

/**
 * A debugging session over the V8 inspector protocol.
 *
 * CDP rather than DAP because it is what the runtime already speaks: a Node
 * process started with --inspect-brk is a debug adapter that needs no adapter
 * installed, no extra process, and no extra dependency. The cost is that this
 * covers JavaScript and TypeScript only; a DAP client for the languages whose
 * runtimes do not speak CDP is a separate piece of work behind the same tool.
 */
export class DebugSession {
  readonly script: string;

  #process: DebugProcess | null = null;
  #socket: WebSocket | null = null;
  #nextId = 1;
  #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  #scripts = new Map<string, string>();
  #frames: DebugFrame[] = [];
  #stopReason = 'launching';
  #running = false;
  #exited = false;
  #waiters = new Set<(reason: string) => void>();
  #breakpoints = new Map<string, Set<number>>();

  constructor(script: string) {
    this.script = script;
  }

  get exited(): boolean {
    return this.#exited;
  }

  get frames(): readonly DebugFrame[] {
    return this.#frames;
  }

  /**
   * Start the program and stop on its first line.
   *
   * --inspect-brk rather than --inspect: a program that is already past the
   * interesting line by the time the debugger attaches has not been debugged.
   * Binding to 127.0.0.1 with port 0 keeps the inspector unreachable from
   * anywhere but this machine, and unpredictable even here.
   */
  async launch(
    launcher: DebugLauncher,
    argv: readonly string[],
    cwd: string | undefined,
  ): Promise<DebugStop> {
    const started = await launcher.launch(
      ['node', '--inspect-brk=127.0.0.1:0', this.script, ...argv],
      cwd,
      `debug ${this.script}`,
    );
    this.#process = started;

    const url = await this.#awaitInspectorUrl(started);
    // The program is running by now. Everything from here can still fail, and
    // a failure that left it running would leave a stopped process nobody can
    // reach and no session to stop it with.
    try {
      await this.#connect(url);
      await this.#send('Runtime.enable', {});
      await this.#send('Debugger.enable', {});
      for (const [file, lines] of this.#breakpoints) {
        for (const line of lines) await this.#armBreakpoint(file, line);
      }
    } catch (error) {
      await this.stop();
      throw error;
    }

    // The runtime is holding at the first line waiting for exactly this.
    const stopped = this.#nextStop();
    await this.#send('Runtime.runIfWaitingForDebugger', {});
    return await stopped;
  }

  /**
   * Ask for a breakpoint by file and line.
   *
   * Accepted before the program starts as well as during it: a breakpoint that
   * could only be set on a running process would be useless for the first line
   * of the run, which is where most of them belong.
   */
  async setBreakpoint(file: string, line: number): Promise<void> {
    const lines = this.#breakpoints.get(file) ?? new Set<number>();
    lines.add(line);
    this.#breakpoints.set(file, lines);
    if (this.#socket) await this.#armBreakpoint(file, line);
  }

  async resume(): Promise<DebugStop> {
    return await this.#move('Debugger.resume');
  }

  async step(kind: 'over' | 'in' | 'out'): Promise<DebugStop> {
    const method =
      kind === 'in' ? 'Debugger.stepInto' : kind === 'out' ? 'Debugger.stepOut' : 'Debugger.stepOver';
    return await this.#move(method);
  }

  /** Evaluate an expression in the frame the program is stopped in. */
  async inspect(expression: string): Promise<string> {
    const frame = this.#frames[0];
    if (!frame) throw new PlifError('INVALID_ARGUMENT', 'the program is not stopped anywhere');

    const result = (await this.#send('Debugger.evaluateOnCallFrame', {
      callFrameId: frame.id,
      expression,
      returnByValue: true,
      silent: true,
    })) as { result?: { value?: unknown; description?: string }; exceptionDetails?: { text?: string } };

    if (result.exceptionDetails) return `threw: ${result.exceptionDetails.text ?? 'error'}`;
    const value = result.result;
    if (value && 'value' in value) return JSON.stringify(value.value) ?? String(value.value);
    return value?.description ?? 'undefined';
  }

  /**
   * The variables visible where the program is stopped.
   *
   * Every scope but the global one, nearest first. A loop body puts its
   * counter in a block scope rather than the function scope, so reading only
   * the local scope reports no `index` on the line that uses it — which is
   * exactly the line someone stopped there wants to look at.
   */
  async locals(): Promise<DebugValue[]> {
    const out: DebugValue[] = [];
    const seen = new Set<string>();

    for (const scope of this.#scopes) {
      const result = (await this.#send('Runtime.getProperties', {
        objectId: scope,
        ownProperties: true,
        generatePreview: false,
      }).catch(() => ({}))) as {
        result?: { name?: string; value?: { value?: unknown; description?: string } }[];
      };

      for (const entry of result.result ?? []) {
        if (!entry.name || seen.has(entry.name)) continue;
        seen.add(entry.name);
        const value = entry.value;
        out.push({
          name: entry.name,
          value:
            value && 'value' in value
              ? (JSON.stringify(value.value) ?? String(value.value))
              : (value?.description ?? 'undefined'),
        });
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
    try {
      this.#socket?.close();
    } catch {
      // A socket that is already gone needs no closing.
    }
    this.#socket = null;
    await this.#process?.stop().catch(() => undefined);
    this.#process = null;
  }

  #scopes: string[] = [];

  async #move(method: string): Promise<DebugStop> {
    if (this.#exited) {
      return { reason: 'exited', frames: [], output: await this.#drain() };
    }
    if (!this.#socket) {
      throw new PlifError('INVALID_ARGUMENT', 'no program is being debugged');
    }
    const stopped = this.#nextStop();
    try {
      await this.#send(method, {});
    } catch {
      // A program can finish between the caller deciding to resume and the
      // request reaching the inspector, which then refuses an operation that
      // only makes sense while paused. Let the socket closing decide which it
      // was: it settles the same wait, and if it never comes this times out
      // exactly as a program that simply kept running would.
      if (this.#exited) this.#settle('exited');
    }
    return await stopped;
  }

  /**
   * The next thing that happens: a pause, or the program ending.
   *
   * Both have to be waited for together. A resume that runs to completion never
   * produces a pause, and a caller waiting only for pauses would hang on every
   * program that finishes — which is most of them.
   */
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

  async #drain(): Promise<string> {
    return (await this.#process?.output().catch(() => '')) ?? '';
  }

  async #armBreakpoint(file: string, line: number): Promise<void> {
    await this.#send('Debugger.setBreakpointByUrl', {
      url: pathToFileURL(file).toString(),
      lineNumber: line - 1,
    }).catch(() => undefined);
  }

  async #awaitInspectorUrl(started: DebugProcess): Promise<string> {
    const deadline = Date.now() + CONNECT_TIMEOUT_MS;
    let seen = '';
    while (Date.now() < deadline) {
      seen += await started.output();
      const found = INSPECTOR_URL.exec(seen);
      if (found) return found[0];
      await new Promise((resolve) => setTimeout(resolve, URL_POLL_MS));
    }
    await started.stop().catch(() => undefined);
    throw new PlifError('INTERNAL', 'the program never opened an inspector', {
      detail: { output: seen.slice(-2_000) },
      hint: 'Only Node programs can be debugged this way.',
    });
  }

  async #connect(url: string): Promise<void> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new PlifError('INTERNAL', 'the inspector did not accept a connection')),
        CONNECT_TIMEOUT_MS,
      );
      timer.unref?.();
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(
          new PlifError('INTERNAL', 'could not reach the inspector', {
            hint: 'A sandbox that isolates the network keeps the debugger out too.',
          }),
        );
      }, { once: true });
    });

    socket.addEventListener('message', (event) => this.#receive(String(event.data)));

    // Both ways the far end can vanish. A socket that errors after the handshake
    // has no listener left from the connect phase, and an unobserved error there
    // leaves a caller waiting for a pause that cannot arrive.
    const ended = (): void => {
      this.#exited = true;
      this.#frames = [];
      if (this.#running) this.#settle('exited');
    };
    socket.addEventListener('close', ended);
    socket.addEventListener('error', ended);
    this.#socket = socket;
  }

  #receive(text: string): void {
    let message: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: unknown };
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }

    if (typeof message.id === 'number') {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new PlifError('INTERNAL', message.error.message ?? 'inspector error'));
      else pending.resolve(message.result ?? {});
      return;
    }

    if (message.method === 'Debugger.scriptParsed') {
      const params = message.params as { scriptId?: string; url?: string };
      if (params.scriptId && params.url) this.#scripts.set(params.scriptId, params.url);
      return;
    }
    if (message.method === 'Debugger.paused') {
      this.#absorbPause(message.params as Record<string, unknown>);
      return;
    }
    if (message.method === 'Runtime.executionContextDestroyed') {
      // Node holds a finished program open while a debugger is attached, so the
      // socket does not close and no further pause arrives. The execution context
      // being destroyed is the program having ended; without this the caller waits
      // out the pause timeout for something that already happened.
      this.#frames = [];
      this.#exited = true;
      if (this.#running) this.#settle('exited');
    }
  }

  #absorbPause(params: Record<string, unknown>): void {
    const raw = (params['callFrames'] ?? []) as {
      callFrameId?: string;
      functionName?: string;
      location?: { scriptId?: string; lineNumber?: number };
      scopeChain?: { type?: string; object?: { objectId?: string } }[];
    }[];

    this.#frames = raw.map((frame) => ({
      id: frame.callFrameId ?? '',
      name: frame.functionName || '(anonymous)',
      file: this.#scripts.get(frame.location?.scriptId ?? '') ?? '(unknown)',
      line: (frame.location?.lineNumber ?? 0) + 1,
    }));
    this.#scopes = (raw[0]?.scopeChain ?? [])
      .filter((scope) => scope.type !== 'global')
      .map((scope) => scope.object?.objectId)
      .filter((objectId): objectId is string => typeof objectId === 'string');
    this.#settle(String(params['reason'] ?? 'paused'));
  }

  async #send(method: string, params: Record<string, unknown>): Promise<unknown> {
    const socket = this.#socket;
    if (!socket) throw new PlifError('INVALID_ARGUMENT', 'no program is being debugged');

    const id = this.#nextId++;
    const answer = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new PlifError('INTERNAL', `the inspector did not answer ${method}`));
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();
      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });

    socket.send(JSON.stringify({ id, method, params }));
    return await answer;
  }

  /** The reason for the current stop, for a caller that did not cause it. */
  get stopReason(): string {
    return this.#stopReason;
  }
}
