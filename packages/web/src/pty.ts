/**
 * PTY providers, native-first.
 *
 * The preferred provider is `node-pty` — the canonical Node PTY (VS Code, ttyd):
 * direct bytes, no extra hop, cross-platform. It is an *optional* dependency
 * because installing it needs a C toolchain (or a matching prebuild); on
 * machines where it cannot build, we fall back to a Python standard-library
 * bridge (`bridge/pty-bridge.py`, `pty.openpty`) so `plif web` still works
 * everywhere with nothing to compile.
 *
 * The server only sees the small `PtyProcess` surface below, so swapping or
 * adding providers stays contained in this file.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

export interface PtySpawnOptions {
  readonly cols: number;
  readonly rows: number;
  readonly cwd: string;
  readonly env?: Record<string, string | undefined>;
}

export interface PtyProcess {
  onData(callback: (data: string) => void): void;
  onExit(callback: (event: { readonly exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: NodeJS.Signals): void;
}

/** Structural view of node-pty; avoids a hard compile-time type dependency. */
interface NativePtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: Record<string, string>;
    },
  ): PtyProcess;
}

const localRequire = createRequire(import.meta.url);

function loadNative(): NativePtyModule | null {
  try {
    return localRequire('node-pty') as NativePtyModule;
  } catch {
    // Not installed (optional dependency skipped) or native binary missing.
    return null;
  }
}

const native = loadNative();

/** Which backend `spawnPty` uses; logged at server start for diagnostics. */
export function ptyProvider(): 'node-pty' | 'python-bridge' {
  return native === null ? 'python-bridge' : 'node-pty';
}

const here = path.dirname(fileURLToPath(import.meta.url));
/** bridge/pty-bridge.py sits at the package root, above both src/ and dist/. */
const BRIDGE_PATH = path.resolve(here, '..', 'bridge', 'pty-bridge.py');

export function spawnPty(
  command: string,
  args: readonly string[],
  options: PtySpawnOptions,
): PtyProcess {
  if (native !== null) {
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    for (const [key, value] of Object.entries(options.env ?? {})) {
      if (value !== undefined) env[key] = value;
    }
    env['TERM'] = 'xterm-256color';
    env['COLORTERM'] = 'truecolor';
    return native.spawn(command, [...args], {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env,
    });
  }
  return spawnBridge(command, args, options);
}

/**
 * Fallback provider backed by the Python bridge.
 *
 * Channel layout (set up here, consumed by the bridge):
 *
 *   bridge stdin  <- bytes to write to the PTY
 *   bridge stdout -> bytes read from the PTY
 *   bridge stderr -> diagnostics
 *   fd 3          <- control channel ("resize <cols> <rows>\n")
 */
function spawnBridge(
  command: string,
  args: readonly string[],
  options: PtySpawnOptions,
): PtyProcess {
  const pythonBin = process.env['PLIF_PYTHON'] ?? 'python3';

  const child: ChildProcess = spawn(
    pythonBin,
    [
      BRIDGE_PATH,
      '--cols',
      String(options.cols),
      '--rows',
      String(options.rows),
      '--cwd',
      options.cwd,
      '--',
      command,
      ...args,
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...options.env },
    },
  );

  const decoder = new StringDecoder('utf8');
  const dataListeners: Array<(data: string) => void> = [];
  const exitListeners: Array<(event: { readonly exitCode: number }) => void> = [];

  child.stdout?.on('data', (chunk: Buffer) => {
    const text = decoder.write(chunk);
    if (text.length === 0) return;
    for (const listener of dataListeners) listener(text);
  });

  child.on('exit', (code: number | null) => {
    const trailing = decoder.end();
    if (trailing.length > 0) {
      for (const listener of dataListeners) listener(trailing);
    }
    const exitCode = typeof code === 'number' ? code : 0;
    for (const listener of exitListeners) listener({ exitCode });
  });

  const control = child.stdio[3];

  return {
    onData(callback) {
      dataListeners.push(callback);
    },
    onExit(callback) {
      exitListeners.push(callback);
    },
    write(data: string) {
      child.stdin?.write(Buffer.from(data, 'utf8'));
    },
    resize(cols: number, rows: number) {
      if (control && 'write' in control) {
        control.write(`resize ${cols} ${rows}\n`);
      }
    },
    kill(signal?: NodeJS.Signals) {
      child.kill(signal ?? 'SIGTERM');
    },
  };
}
