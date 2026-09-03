/**
 * The host half of Code Mode: spawn the program, serve its tool calls, decide
 * what the model gets to read.
 *
 * The program runs in its own OS process, started by the container and confined
 * by whatever the sandbox backend can enforce on this machine. That is not a
 * detail — it is the condition Code Mode was held back for. A worker thread
 * runs with the host's privileges and `node:vm` is a language boundary rather
 * than a security one, so neither could carry model-written code. A process the
 * jail spawned carries exactly as much privilege as the `run_command` the model
 * could have issued instead, and rather less: every tool call it makes comes
 * back through this file into the same dispatcher, policy engine and audit log
 * the native presentation uses.
 *
 * What crosses back into the conversation is deliberately narrow: the logs the
 * program printed and the value it returned. The ten file reads it did to
 * produce three lines are recorded for the developer and the audit log, and are
 * never spent as context.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Container } from '../../container/container.js';
import { PlifError } from '../../errors.js';
import { DispatchScheduler, type DispatchOutcome } from './scheduler.js';
import { FrameReader, encodeFrame } from './protocol.js';
import type { CodeDispatchRecord, CodeModeLimits, CodeModeResult, CodeRunFailureKind } from './types.js';

export interface CodeRuntimeRequest {
  /** The program body, as the model wrote it. */
  readonly source: string;
  readonly container: Container;
  /** Names the generated SDK promised; anything else is not reachable. */
  readonly toolNames: readonly string[];
  readonly limits: CodeModeLimits;
  /** The `run_code` call id, so nested ids stay traceable to their parent. */
  readonly callIdPrefix: string;
  /** Isolation the sandbox reported, used to place the runtime's binary. */
  readonly isolation?: string;
  readonly signal?: AbortSignal;
  readonly isParallelSafe: (name: string) => boolean;
  readonly dispatch: (
    name: string,
    args: Record<string, unknown>,
    callId: string,
  ) => Promise<DispatchOutcome>;
  readonly onDispatch?: (record: CodeDispatchRecord) => void;
}

/** Anything longer than this in a rendered result is a file, not a message. */
const RESULT_INDENT = 2;

/**
 * Ceiling on everything the runtime sends the host across one run.
 *
 * Separate from `outputBytes`, which bounds what the *model* reads. Most of
 * this budget is tool arguments — a program writing a large file sends that
 * file through here — so a limit sized for logs would refuse ordinary work.
 * It exists to stop a program that never emits a newline from growing a host
 * buffer until the developer's machine runs out of memory.
 */
const MAX_INBOUND_BYTES = 16 * 1024 * 1024;

/** Where the runtime lives inside a container, written once per session. */
const RUNTIME_DIRECTORY = '/tmp/plif-code';

let cachedRunnerSource: string | undefined;

/**
 * Containers that already have the runtime installed.
 *
 * The file does not change while the process is running, so rewriting it for
 * every program would charge the container's disk budget and add an audit entry
 * for a byte-identical write. Weak so a finished container is still collectable.
 */
const installedRuntimes = new WeakSet<Container>();

/**
 * Locate the runtime source that ships with this package.
 *
 * The two candidates are the compiled layout and the source layout, matching
 * how the agent instruction assets are already resolved: `dist/` never contains
 * the file because it is not TypeScript, so a published install reads it from
 * the `src/` subtree the package explicitly ships.
 */
function runnerSource(): string {
  if (cachedRunnerSource !== undefined) return cachedRunnerSource;
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDirectory, 'runtime', 'runner.mjs'),
    path.resolve(moduleDirectory, '../../../src/harness/code-mode/runtime/runner.mjs'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      cachedRunnerSource = fs.readFileSync(candidate, 'utf8');
      return cachedRunnerSource;
    }
  }
  throw new PlifError('INTERNAL', 'the Code Mode runtime asset is missing from this install', {
    hint: 'Reinstall @plif/core, or set the tool presentation mode back to native.',
  });
}

/**
 * Which Node runs the program.
 *
 * A bare `node` rather than `process.execPath`, and the reason is policy rather
 * than convenience: the standing rule that lets the agent run build tooling
 * matches on the command it typed, so an absolute path would turn every program
 * into an approval prompt for something the agent was already allowed to do.
 * The override exists for installs where `node` is not on the container's PATH.
 */
function nodeBinary(): string {
  const override = process.env['PLIF_CODE_MODE_NODE'];
  return override && override.trim() ? override.trim() : 'node';
}

function looksLikeMissingBinary(stderr: string, exitCode: number): boolean {
  return (
    exitCode === 127 ||
    /ENOENT|not recognized|command not found|cannot find the (file|path)/i.test(stderr)
  );
}

/**
 * Render logs and result the way the model will read them.
 *
 * A string result is emitted verbatim because the program chose that shape on
 * purpose; anything else is pretty-printed, because a model asked to parse a
 * single-line JSON blob will spend a turn re-reading it.
 */
function renderRun(logs: readonly string[], value: unknown, hasValue: boolean, cap: number): string {
  const parts: string[] = [];
  if (logs.length > 0) parts.push(logs.join('\n'));
  if (hasValue) {
    const rendered =
      typeof value === 'string' ? value : JSON.stringify(value, null, RESULT_INDENT) ?? String(value);
    parts.push(logs.length > 0 ? `\nResult:\n${rendered}` : rendered);
  }
  const text = parts.join('\n').trim();
  if (!text) return '(run_code completed with no output)';
  if (Buffer.byteLength(text, 'utf8') <= cap) return text;
  return `${text.slice(0, cap)}\n…[output truncated at ${cap} bytes]`;
}

interface Verdict {
  readonly kind: 'done' | 'failed';
  readonly value?: unknown;
  readonly hasValue?: boolean;
  readonly failureKind?: CodeRunFailureKind;
  readonly message?: string;
}

function asFailureKind(value: string): CodeRunFailureKind {
  switch (value) {
    case 'timeout':
    case 'abort':
    case 'process-exit':
    case 'invalid-output':
    case 'output-limit':
    case 'call-limit':
    case 'unavailable':
      return value;
    default:
      return 'exception';
  }
}

/**
 * Run one program to completion and report what happened.
 *
 * Never rejects for a program's own failure. A thrown exception, an expired
 * budget and a killed process are all things the model can fix on the next
 * turn, and they are only fixable if they come back as a result it can read.
 */
export async function runCodeProgram(request: CodeRuntimeRequest): Promise<CodeModeResult> {
  const { container, limits, source } = request;

  if (Buffer.byteLength(source, 'utf8') > limits.sourceBytes) {
    return {
      output: `run_code failed (exception): the program is larger than ${limits.sourceBytes} bytes`,
      ok: false,
      toolCallCount: 0,
      failure: { kind: 'exception', message: 'program too large' },
      dispatches: [],
    };
  }

  const runId = randomUUID().slice(0, 8);
  // One directory per run, and it is left behind on purpose: it lives in the
  // container's disposable `/tmp`, it goes when the container does, and
  // deleting it would put an approval prompt in front of every program the
  // model writes — deletion is the one filesystem action policy always asks
  // about. What survives is also what makes a failed run reproducible by hand.
  const virtualDirectory = `${RUNTIME_DIRECTORY}/${runId}`;
  const token = randomUUID();
  const windows = process.platform === 'win32';
  const endpoint = windows
    ? { kind: 'pipe' as const, path: `\\\\.\\pipe\\plif-code-${runId}` }
    : { kind: 'unix' as const, path: './s' };

  if (!installedRuntimes.has(container)) {
    await container.writeFile(`${RUNTIME_DIRECTORY}/runner.mjs`, runnerSource());
    installedRuntimes.add(container);
  }
  await container.writeFile(`${virtualDirectory}/program.ts`, source);
  await container.writeFile(
    `${virtualDirectory}/manifest.json`,
    JSON.stringify({
      token,
      endpoint,
      programFile: 'program.ts',
      toolNames: [...request.toolNames].sort(),
      limits: { outputBytes: limits.outputBytes, computeMs: limits.computeMs },
    }),
  );

  const hostDirectory = await container.hostPathFor(virtualDirectory);
  const listenPath = windows ? endpoint.path : path.join(hostDirectory, 's');
  if (!windows && Buffer.byteLength(listenPath, 'utf8') > 100) {
    return {
      output:
        'run_code failed (unavailable): the container path is too long for a local socket. ' +
        'Move the workspace closer to the filesystem root or use native tool calls.',
      ok: false,
      toolCallCount: 0,
      failure: { kind: 'unavailable', message: 'socket path too long' },
      dispatches: [],
    };
  }

  const logs: string[] = [];
  const dispatches: CodeDispatchRecord[] = [];
  const runController = new AbortController();
  const onOuterAbort = (): void => runController.abort();
  request.signal?.addEventListener('abort', onOuterAbort, { once: true });

  let verdict: Verdict | undefined;
  let resolveVerdict: () => void = () => undefined;
  const settled = new Promise<void>((resolve) => {
    resolveVerdict = resolve;
  });
  const settle = (next: Verdict): void => {
    if (verdict) return;
    verdict = next;
    resolveVerdict();
  };

  const scheduler = new DispatchScheduler({
    maxParallel: limits.maxConcurrency,
    maxCalls: limits.maxCalls,
    isParallelSafe: request.isParallelSafe,
    dispatch: request.dispatch,
    callIdPrefix: request.callIdPrefix,
    signal: runController.signal,
    onCommit: (record) => {
      dispatches.push(record);
      request.onDispatch?.(record);
    },
  });

  const server = net.createServer();
  let peer: net.Socket | undefined;

  server.on('connection', (socket) => {
    // One program, one connection. A second caller on this endpoint is either a
    // bug or the program trying to open a second lane for itself, and neither
    // is something to serve.
    if (peer) {
      socket.destroy();
      return;
    }
    peer = socket;
    socket.setEncoding('utf8');
    let greeted = false;
    const reader = new FrameReader(MAX_INBOUND_BYTES);

    socket.on('data', (chunk: string) => {
      if (reader.overflowed) {
        settle({
          kind: 'failed',
          failureKind: 'output-limit',
          message: 'the program sent more data than the run allows',
        });
        socket.destroy();
        return;
      }
      for (const frame of reader.push(chunk)) {
        if (frame.t === 'hello') {
          if (frame.token !== token) {
            socket.destroy();
            return;
          }
          greeted = true;
          socket.write(encodeFrame({ t: 'ready' }));
          continue;
        }
        if (!greeted) continue;
        if (frame.t === 'log') {
          logs.push(frame.text);
          continue;
        }
        if (frame.t === 'done') {
          settle({ kind: 'done', value: frame.value, hasValue: frame.hasValue });
          continue;
        }
        if (frame.t === 'fail') {
          settle({
            kind: 'failed',
            failureKind: asFailureKind(frame.kind),
            message: frame.message,
          });
          continue;
        }
        if (frame.t === 'call') {
          void serveCall(socket, scheduler, frame.id, frame.name, frame.args);
        }
      }
    });
    socket.on('error', () => undefined);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(listenPath, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (error) {
    request.signal?.removeEventListener('abort', onOuterAbort);
    const message = error instanceof Error ? error.message : String(error);
    return {
      output: `run_code failed (unavailable): could not open the runtime channel (${message})`,
      ok: false,
      toolCallCount: 0,
      failure: { kind: 'unavailable', message },
      dispatches: [],
    };
  }

  try {
    const exec = await runProcess(request, virtualDirectory, runController.signal);

    // The process is gone; anything it was going to say, it has said. Waiting
    // here only drains frames already sitting in the socket buffer.
    await Promise.race([settled, new Promise<void>((resolve) => setTimeout(resolve, 50))]);

    if (!verdict) {
      if (exec.killedBy === 'timeout') {
        settle({
          kind: 'failed',
          failureKind: 'timeout',
          message: `the program ran longer than ${limits.timeoutMs}ms`,
        });
      } else if (exec.killedBy === 'cancelled' || runController.signal.aborted) {
        settle({ kind: 'failed', failureKind: 'abort', message: 'the run was cancelled' });
      } else {
        const detail = (exec.stderr || exec.stdout).trim().split('\n').slice(-4).join('\n');
        settle({
          kind: 'failed',
          failureKind: 'process-exit',
          message: `the runtime exited with code ${exec.exitCode}${detail ? `: ${detail}` : ''}`,
        });
      }
    }
  } catch (error) {
    // A container that will not spawn — no `exec` capability, a policy that
    // denied it, a jail that is already down. The run has still opened a
    // socket and a scheduler, and the cleanup below has to happen either way,
    // so the failure becomes a verdict rather than an escape.
    settle({
      kind: 'failed',
      failureKind: 'unavailable',
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    request.signal?.removeEventListener('abort', onOuterAbort);
    runController.abort();
    await scheduler.close();
    peer?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  const decided = verdict as Verdict;
  const toolCallCount = scheduler.dispatched;

  if (decided.kind === 'done') {
    return {
      output: renderRun(logs, decided.value, decided.hasValue === true, limits.outputBytes),
      ok: true,
      toolCallCount,
      dispatches,
      ...(request.isolation ? { isolation: request.isolation } : {}),
    };
  }

  const kind = decided.failureKind ?? 'exception';
  const trace = logs.length > 0 ? `\n\nLogged before the failure:\n${logs.join('\n')}` : '';
  return {
    output: `run_code failed (${kind}): ${decided.message ?? 'no detail'}${trace}`,
    ok: false,
    toolCallCount,
    failure: { kind, message: decided.message ?? 'no detail' },
    dispatches,
    ...(request.isolation ? { isolation: request.isolation } : {}),
  };
}

async function serveCall(
  socket: net.Socket,
  scheduler: DispatchScheduler,
  id: number,
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  try {
    const outcome = await scheduler.submit(name, args);
    socket.write(
      outcome.ok
        ? encodeFrame({
            t: 'result',
            id,
            output: outcome.output,
            ...(outcome.diff !== undefined ? { diff: outcome.diff } : {}),
          })
        : encodeFrame({ t: 'error', id, message: outcome.output }),
    );
  } catch (error) {
    socket.write(
      encodeFrame({
        t: 'error',
        id,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * Start the runtime process, retrying once if `node` was not on the PATH.
 *
 * The retry exists because the container's environment is deliberately small:
 * an install that withholds `envRead` has no PATH at all, and falling back to
 * the interpreter already running is better than telling the developer their
 * program failed for a reason that has nothing to do with their program.
 */
async function runProcess(
  request: CodeRuntimeRequest,
  cwd: string,
  signal: AbortSignal,
): Promise<{ exitCode: number; stdout: string; stderr: string; killedBy?: string }> {
  const argv = ['../runner.mjs', './manifest.json'];
  const reason = 'run a run_code program in a sandboxed process';
  const first = await request.container.exec({
    argv: [nodeBinary(), ...argv],
    cwd,
    timeoutMs: request.limits.timeoutMs,
    reason,
    signal,
  });
  if (first.exitCode === 0 || !looksLikeMissingBinary(first.stderr, first.exitCode)) return first;
  if (nodeBinary() !== 'node') return first;
  return await request.container.exec({
    argv: [process.execPath, ...argv],
    cwd,
    timeoutMs: request.limits.timeoutMs,
    reason,
    signal,
  });
}
