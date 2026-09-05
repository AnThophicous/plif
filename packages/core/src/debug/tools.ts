import path from 'node:path';

import type { Tool, ToolContext, ToolResult } from '../harness/tools.js';
import { DebugSession } from './session.js';
import type { DebugLauncher, DebugProcess, DebugStop } from './session.js';

/**
 * The slice of the container a debuggee needs.
 *
 * Written structurally so that this module depends on the four calls it makes
 * rather than on the container class: the point of going through them is that
 * every gate they carry — the exec capability, the approval prompt, the audit
 * entry, the jail — applies to the debugged program exactly as it does to any
 * other command. A debugger that spawned the process itself would be a hole in
 * all four.
 */
interface DebugHost {
  startTerminal(request: {
    argv: readonly string[];
    cwd?: string;
    reason: string;
  }): Promise<{ terminalId: string; ownerId: string }>;
  readTerminal(
    id: string,
    ownerId: string,
  ): Promise<readonly { readonly stream: string; readonly chunk: string }[]>;
  closeTerminal(id: string, ownerId: string): Promise<unknown>;
}

function launcherFor(host: DebugHost): DebugLauncher {
  return {
    async launch(argv, cwd, reason): Promise<DebugProcess> {
      const { terminalId, ownerId } = await host.startTerminal({
        argv,
        ...(cwd ? { cwd } : {}),
        reason,
      });
      return {
        async output(): Promise<string> {
          const chunks = await host.readTerminal(terminalId, ownerId);
          return chunks.map((entry) => entry.chunk).join('');
        },
        async stop(): Promise<void> {
          await host.closeTerminal(terminalId, ownerId);
        },
      };
    },
  };
}

/**
 * One session at a time, held across tool calls.
 *
 * A debugger is stateful in a way no other tool here is: `continue` means
 * nothing without the `launch` that came before it. The alternative — passing a
 * session handle back and forth — buys nothing, because there is no reason to
 * debug two programs at once and every reason not to leave one running.
 */
export class DebugSessions {
  #active: DebugSession | null = null;
  #pending = new Map<string, Set<number>>();

  get active(): DebugSession | null {
    return this.#active;
  }

  get pendingBreakpoints(): ReadonlyMap<string, ReadonlySet<number>> {
    return this.#pending;
  }

  remember(file: string, line: number): void {
    const lines = this.#pending.get(file) ?? new Set<number>();
    lines.add(line);
    this.#pending.set(file, lines);
  }

  async open(script: string): Promise<DebugSession> {
    await this.close();
    const session = new DebugSession(script);
    for (const [file, lines] of this.#pending) {
      for (const line of lines) await session.setBreakpoint(file, line);
    }
    this.#active = session;
    return session;
  }

  async close(): Promise<void> {
    const session = this.#active;
    this.#active = null;
    await session?.stop().catch(() => undefined);
  }
}

/**
 * Node announces its own bookkeeping on the way out; the program did not.
 */
function programOutput(output: string): string {
  return output
    .split('\n')
    .filter(
      (line) =>
        line.trim() !== 'Debugger attached.' &&
        !line.startsWith('Waiting for the debugger to disconnect') &&
        !line.startsWith('Debugger listening on'),
    )
    .join('\n')
    .trimEnd();
}

function describe(stop: DebugStop, root: string): string {
  if (stop.reason === 'exited') {
    return `The program finished.${programOutput(stop.output) ? `\n\n${programOutput(stop.output)}` : ''}`;
  }
  if (stop.reason === 'timeout') {
    return 'The program is still running and has not hit a breakpoint.';
  }

  const where = stop.frames
    .slice(0, 8)
    .map((frame) => `  ${shorten(frame.file, root)}:${frame.line}  ${frame.name}`)
    .join('\n');
  const deeper =
    stop.frames.length > 8 ? `\n  … and ${stop.frames.length - 8} frames below` : '';
  return (
    `Stopped (${stop.reason})\n${where}${deeper}` +
    (programOutput(stop.output) ? `\n\nOutput so far:\n${programOutput(stop.output)}` : '')
  );
}

function shorten(file: string, root: string): string {
  const local = file.startsWith('file://') ? decodeURIComponent(new URL(file).pathname) : file;
  const cleaned = process.platform === 'win32' ? local.replace(/^\//, '') : local;
  const relative = path.relative(root, cleaned);
  return !relative || relative.startsWith('..') ? file : relative.split(path.sep).join('/');
}

export function debugTool(sessions: DebugSessions, root: string): Tool {
  return {
    spec: {
      name: 'debug',
      description:
        'Run a program under a debugger and look at it while it is stopped, instead of ' +
        'adding print statements and running it again. Set a breakpoint, launch, then ' +
        'step and inspect expressions in the frame where it stopped. One session at a ' +
        'time. Node programs only for now.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['breakpoint', 'launch', 'continue', 'step', 'stack', 'inspect', 'stop'],
            description:
              'breakpoint before launching or while stopped; launch starts the program ' +
              'and runs to the first breakpoint; step moves one line; inspect evaluates ' +
              'an expression where it is stopped; stop ends the session',
          },
          path: { type: 'string', description: 'Container-absolute path, for breakpoint and launch' },
          line: { type: 'number', description: '1-based line, for breakpoint' },
          expression: { type: 'string', description: 'What to evaluate, for inspect' },
          into: {
            type: 'string',
            enum: ['over', 'in', 'out'],
            description: 'How to step: over the call (default), into it, or out of it',
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Arguments passed to the program, for launch',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
    },
    async run(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const action = String(input['action'] ?? '');
      const host = context.container as unknown as DebugHost;

      if (action === 'stop') {
        await sessions.close();
        return { output: 'Debug session ended.', ok: true };
      }

      if (action === 'breakpoint') {
        const target = typeof input['path'] === 'string' ? input['path'] : '';
        const line = Number(input['line']);
        if (!target || !Number.isFinite(line) || line < 1) {
          return { output: 'breakpoint needs path and a 1-based line.', ok: false };
        }
        const file = await context.container.hostPathFor(target);
        sessions.remember(file, line);
        await sessions.active?.setBreakpoint(file, line);
        return { output: `Breakpoint at ${target}:${line}.`, ok: true };
      }

      if (action === 'launch') {
        const target = typeof input['path'] === 'string' ? input['path'] : '';
        if (!target) return { output: 'launch needs the path of the program to run.', ok: false };

        const script = await context.container.hostPathFor(target);
        const session = await sessions.open(script);
        const args = Array.isArray(input['args']) ? input['args'].map(String) : [];
        try {
          const stop = await session.launch(launcherFor(host), args, undefined);
          return { output: describe(stop, root), ok: true };
        } catch (error) {
          await sessions.close();
          return { output: `Could not start the debugger: ${String(error)}`, ok: false };
        }
      }

      const session = sessions.active;
      if (!session) {
        return { output: 'No program is being debugged. Launch one first.', ok: false };
      }

      if (action === 'stack') {
        if (session.frames.length === 0) {
          return { output: 'The program is not stopped anywhere.', ok: false };
        }
        return {
          output: describe(
            { reason: session.stopReason, frames: session.frames, output: '' },
            root,
          ),
          ok: true,
        };
      }

      if (action === 'inspect') {
        const expression = typeof input['expression'] === 'string' ? input['expression'].trim() : '';
        if (!expression) {
          const locals = await session.locals();
          if (locals.length === 0) return { output: 'No locals in this frame.', ok: true };
          return {
            output: locals.map((local) => `${local.name} = ${local.value}`).join('\n'),
            ok: true,
          };
        }
        try {
          return { output: `${expression} = ${await session.inspect(expression)}`, ok: true };
        } catch (error) {
          return { output: String(error), ok: false };
        }
      }

      if (action === 'continue' || action === 'step') {
        const into = input['into'];
        const stop =
          action === 'continue'
            ? await session.resume()
            : await session.step(into === 'in' ? 'in' : into === 'out' ? 'out' : 'over');
        if (stop.reason === 'exited') await sessions.close();
        return { output: describe(stop, root), ok: true };
      }

      return { output: `Unknown debug action "${action}".`, ok: false };
    },
  };
}

export function debugTools(sessions: DebugSessions, root: string): Tool[] {
  return [debugTool(sessions, root)];
}
