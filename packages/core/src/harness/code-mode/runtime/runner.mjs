/**
 * The other side of Code Mode: the process the model's program actually runs in.
 *
 * This file is written into the container and executed as a separate OS
 * process, inside the same jail every `run_command` goes through. That is the
 * whole reason Code Mode is allowed to exist at all — `node:vm` is a separate
 * JavaScript context and a worker thread shares the host's privileges, so
 * neither is a boundary. A process the sandbox spawned is one.
 *
 * Nothing in here is trusted by the host. It reports; the host decides. The
 * program cannot reach a tool except by asking, and every answer it gets came
 * back through the host's policy engine, audit log and path jail.
 *
 * Plain JavaScript, no dependencies, no build step: it has to run under the
 * same Node the host is running and it has to survive being copied into a
 * container whose only guarantee is a filesystem.
 */

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const manifestPath = process.argv[2];
if (!manifestPath) {
  process.stderr.write('plif code runner: no manifest\n');
  process.exit(64);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const runDirectory = path.dirname(path.resolve(manifestPath));
const program = fs.readFileSync(path.resolve(runDirectory, manifest.programFile), 'utf8');
const outputBytes = Number(manifest.limits?.outputBytes) || 32768;
const computeMs = Number(manifest.limits?.computeMs) || 60000;

const socket = net.connect(
  manifest.endpoint.kind === 'pipe'
    ? manifest.endpoint.path
    : path.resolve(runDirectory, manifest.endpoint.path),
);
socket.setEncoding('utf8');
socket.setNoDelay?.(true);

let finished = false;
let inbound = '';
let logBudget = outputBytes;
let nextCallId = 1;
const pending = new Map();

function send(frame) {
  if (socket.destroyed) return;
  socket.write(`${JSON.stringify(frame)}\n`);
}

/**
 * Report once and leave.
 *
 * The guard matters more than it looks: a program that throws inside a `catch`
 * that is itself reporting a throw would otherwise send two verdicts for one
 * run, and the host would attribute the second to a run that had already ended.
 */
function finish(frame, code) {
  if (finished) return;
  finished = true;
  send(frame);
  socket.end();
  setTimeout(() => process.exit(code), 50).unref?.();
}

function fail(kind, message) {
  finish({ t: 'fail', kind, message: String(message).slice(0, 4000) }, 0);
}

/**
 * Format a console argument the way a developer reading the transcript expects.
 *
 * Not `util.inspect`: its output includes colours, getters and circular markers
 * that would land in the model's context as noise. An object the program wants
 * the model to read should be JSON; an object that will not serialise says so.
 */
function render(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    const text = JSON.stringify(value, null, 2);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}

/**
 * Stream a log line immediately rather than batching until the end.
 *
 * A program killed by a budget has still done work worth seeing, and the lines
 * it printed before it was killed are usually the evidence of why. Batching
 * would throw away exactly the output that explains the failure.
 */
function log(args) {
  if (logBudget <= 0) return;
  const text = args.map(render).join(' ');
  const trimmed = text.length > logBudget ? `${text.slice(0, logBudget)}\n…[log truncated]` : text;
  logBudget -= Buffer.byteLength(trimmed, 'utf8');
  send({ t: 'log', text: trimmed });
}

const shim = {
  log: (...args) => log(args),
  info: (...args) => log(args),
  warn: (...args) => log(args),
  error: (...args) => log(args),
  debug: (...args) => log(args),
};

class ToolCallError extends Error {
  constructor(toolName, output) {
    super(output || `${toolName} failed`);
    this.name = 'ToolCallError';
    this.toolName = toolName;
    this.output = output;
  }
}

/**
 * The `tools` global, built with own properties on a null prototype.
 *
 * A tool named `__proto__` or `constructor` has to be an ordinary key. Plain
 * assignment would hit the prototype setter instead and either silently drop
 * the tool or, worse, mutate an object the rest of this file reads through.
 */
const tools = Object.create(null);
for (const name of manifest.toolNames ?? []) {
  Object.defineProperty(tools, name, {
    enumerable: true,
    value: (args) =>
      new Promise((resolve, reject) => {
        if (finished || socket.destroyed) {
          reject(new ToolCallError(name, 'the run is over; this call was not dispatched'));
          return;
        }
        const id = nextCallId++;
        pending.set(id, { resolve, reject, name });
        send({ t: 'call', id, name, args: args && typeof args === 'object' ? args : {} });
      }),
  });
}

function handle(frame) {
  if (!frame || typeof frame !== 'object') return;
  if (frame.t === 'ready') {
    void start();
    return;
  }
  const waiting = pending.get(frame.id);
  if (!waiting) return;
  pending.delete(frame.id);
  if (frame.t === 'result') {
    const result = Object.create(null);
    Object.defineProperty(result, 'ok', { value: true, enumerable: true });
    Object.defineProperty(result, 'output', { value: String(frame.output ?? ''), enumerable: true });
    if (typeof frame.diff === 'string') {
      Object.defineProperty(result, 'diff', { value: frame.diff, enumerable: true });
    }
    waiting.resolve(result);
    return;
  }
  waiting.reject(new ToolCallError(waiting.name, String(frame.message ?? 'tool call failed')));
}

socket.on('data', (chunk) => {
  inbound += chunk;
  const parts = inbound.split('\n');
  inbound = parts.pop() ?? '';
  for (const part of parts) {
    if (!part.trim()) continue;
    try {
      handle(JSON.parse(part));
    } catch {
      // A frame the host could not have sent is not the program's business.
    }
  }
});

socket.on('error', (error) => {
  process.stderr.write(`plif code runner: socket ${error.message}\n`);
  process.exit(70);
});

socket.on('close', () => {
  if (!finished) process.exit(70);
});

socket.on('connect', () => send({ t: 'hello', token: manifest.token }));

/**
 * Charge the program for time it actually spent computing.
 *
 * Wall clock cannot distinguish a program waiting on a slow grep from a program
 * spinning in a loop, and killing the first for the sins of the second makes
 * every legitimate long tool call a hazard. Event-loop utilisation measures the
 * busy half of that, so a program can wait as long as its wall budget allows
 * and still be stopped the moment it starts burning the machine.
 */
function armComputeBudget() {
  let baseline = performance.eventLoopUtilization();
  const timer = setInterval(() => {
    const usage = performance.eventLoopUtilization(baseline);
    if (usage.active > computeMs) {
      clearInterval(timer);
      fail('timeout', `the program used more than ${computeMs}ms of compute`);
    }
  }, 25);
  timer.unref?.();
}

async function start() {
  armComputeBudget();
  let body = program;
  try {
    const module = await import('node:module');
    if (typeof module.stripTypeScriptTypes === 'function') {
      body = module.stripTypeScriptTypes(`async function __plif_main__() {\n${program}\n}`, {
        mode: 'strip',
      });
    } else {
      body = `async function __plif_main__() {\n${program}\n}`;
    }
  } catch (error) {
    fail(
      'exception',
      `the program is not valid erasable TypeScript: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  let value;
  try {
    const run = new AsyncFunction(
      'tools',
      'ToolCallError',
      'console',
      `${body}\nreturn __plif_main__();`,
    );
    value = await run(tools, ToolCallError, shim);
  } catch (error) {
    const detail =
      error instanceof Error
        ? `${error.name}: ${error.message}${error.stack ? `\n${error.stack.split('\n').slice(1, 4).join('\n')}` : ''}`
        : String(error);
    fail('exception', detail);
    return;
  }

  if (value === undefined) {
    finish({ t: 'done', hasValue: false }, 0);
    return;
  }
  let serialised;
  try {
    serialised = JSON.stringify(value);
  } catch {
    serialised = undefined;
  }
  if (serialised === undefined) {
    fail('invalid-output', 'the returned value is not JSON; return a plain object, array or string');
    return;
  }
  if (Buffer.byteLength(serialised, 'utf8') > outputBytes) {
    fail(
      'output-limit',
      `the returned value is larger than ${outputBytes} bytes; return a summary and write the rest to a file`,
    );
    return;
  }
  finish({ t: 'done', value: JSON.parse(serialised), hasValue: true }, 0);
}

process.on('uncaughtException', (error) => fail('exception', error?.stack ?? String(error)));
process.on('unhandledRejection', (reason) => fail('exception', String(reason)));
