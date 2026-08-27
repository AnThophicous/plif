/**
 * PTY provider backed by a small Python bridge.
 *
 * `node-pty` needs a C toolchain that is not present on every machine, so the
 * real pseudo-terminal is allocated by the Python standard library instead
 * (`pty.openpty`). This module only spawns that bridge and wires its four
 * channels:
 *
 *   bridge stdin  <- bytes to write to the PTY
 *   bridge stdout -> bytes read from the PTY
 *   bridge stderr -> diagnostics
 *   fd 3          <- control channel ("resize <cols> <rows>\n")
 *
 * The surface mirrors the small part of the node-pty API the server uses.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';

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

const here = path.dirname(fileURLToPath(import.meta.url));
/** bridge/pty-bridge.py sits at the package root, above both src/ and dist/. */
const BRIDGE_PATH = path.resolve(here, '..', 'bridge', 'pty-bridge.py');

export function spawnPty(
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
