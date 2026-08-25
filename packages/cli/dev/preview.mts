/**
 * Frame previewer.
 *
 * A TUI cannot be developed blind, and it cannot be rendered at all without a
 * TTY — which means no CI job, no test runner and no agent can see what this
 * app actually looks like. This harness supplies a fake TTY pair, drives the
 * app with a scripted sequence of keystrokes, and prints the resulting frame to
 * stdout with ANSI colour intact.
 *
 *   node --import tsx packages/cli/dev/preview.mts [columns] [scenario]
 *
 * Scenarios live in `SCENARIOS` below. Add one whenever you change a screen
 * that is awkward to reach by hand — the approval dialog especially, since it
 * only appears when policy escalates.
 */

// First, and on its own line with nothing above it. See the module's comment:
// chalk decides its colour level when it is imported, so this has to have run
// by then, and only a separate module is guaranteed to.
import './force-color.mjs';

import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { render } from 'ink';
import React from 'react';

import { Engine, ProviderCapabilityCache } from '@plif/core';

import { App } from '../src/app.js';
import { detachImmediateInkResize } from '../src/terminal-resize.js';
import { activateTheme, loadThemes } from '../src/themes.js';
import { VERSION } from '../src/version.js';

/** A writable that keeps every frame Ink paints instead of clearing them. */
class FakeStdout extends EventEmitter {
  columns: number;
  rows: number;
  isTTY = true as const;
  frames: string[] = [];

  constructor(columns: number, rows = 40) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  /** Drag the window, the way a person does. */
  resize(columns: number, rows: number): void {
    this.columns = columns;
    this.rows = rows;
    this.emit('resize');
  }

  /**
   * Lines written that were wider than the terminal they went into.
   *
   * The precise invariant behind the resize ghosting. Ink erases a frame by
   * moving the cursor up by the number of lines it believes it wrote — a count
   * of `\n`, not of physical rows. A line wider than the terminal occupies two
   * physical rows, so the erase comes up short and the overflow stays on
   * screen as a duplicate. Counting the over-wide lines catches the cause
   * directly, rather than squinting at the output for ghosts.
   */
  overflows: { columns: number; width: number; text: string }[] = [];

  write(chunk: string | Uint8Array): boolean {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    this.frames.push(text);
    for (const line of stripAnsi(text).split('\n')) {
      const width = [...line].length;
      if (width > this.columns) {
        this.overflows.push({ columns: this.columns, width, text: line.slice(0, 60) });
      }
    }
    return true;
  }
  end(): void {}
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1b\[[\d;?]*[a-zA-Z]/g, '');
}

/**
 * A readable that claims raw-mode support so `useInput` will attach.
 *
 * It must be a genuine stream, not an EventEmitter that fakes `data`: Ink
 * subscribes with `on('readable')` and pulls with `read()`, so an emitter that
 * only emits `data` is silently ignored and every scripted keystroke vanishes.
 */
class FakeStdin extends Readable {
  isTTY = true as const;

  override _read(): void {
    // Data is pushed from the scenario driver, never pulled from a source.
  }

  setRawMode(): this {
    return this;
  }

  // Ink refs/unrefs stdin to control whether it keeps the loop alive. A plain
  // Readable has neither method, and Ink calls them unconditionally.
  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  /** Queue a keystroke sequence for Ink to read on the next tick. */
  send(sequence: string): void {
    this.push(sequence);
  }

  /**
   * Type a string the way a person does: one chunk per character.
   *
   * Pushing the whole string at once is not equivalent — Ink delivers a chunk
   * as a single `useInput` event, so "abc\r" arrives as one four-character
   * "key" rather than three letters and a Return, and nothing submits.
   */
  async type(sequence: string, delayMs = 6): Promise<void> {
    for (const char of sequence) {
      this.push(char);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * `capture` snapshots the screen at that point in the script instead of only at
 * the end. Without it, anything transient — streaming output, a spinner, a
 * half-finished command — is invisible, because by the time the scenario ends
 * it has already resolved.
 */
type Step =
  | { type: string }
  | { paste: string }
  | { click: [number, number] }
  | { wait: number }
  | { capture: string }
  | { resize: [number, number] }
  /**
   * Push an engine event straight onto the bus.
   *
   * The panels added for thinking, compaction, questions and subagents are all
   * driven by events the loop emits, and reaching them through a real model run
   * means a network call, a non-deterministic frame, and no way to preview the
   * screen at all when the endpoint is down. Emitting the event directly
   * renders exactly what the real one renders, because the app cannot tell the
   * difference — it only ever sees the bus.
   */
  | { emit: [string, unknown] };

const columnsArg = Number(process.argv[2] ?? 96);
const rows = Number(process.argv[4] ?? 40);

const SCENARIOS: Record<string, Step[]> = {
  /** A Plif-styled prompt at rest must settle instead of repainting forever. */
  'idle-plif': [{ wait: 900 }],

  /** A live tool row with the Chromatic Reactor working treatment. */
  'working-plif': [
    { wait: 200 },
    {
      emit: [
        'agent.tool',
        {
          id: 'preview-working',
          name: 'run_command',
          input: { command: 'npm test' },
          phase: 'start',
        },
      ],
    },
    { wait: 600 },
    { capture: 'working-plif' },
  ],

  /** An active reasoning row, without a model call. */
  'thinking-plif': [
    { wait: 200 },
    { emit: ['agent.thinking', { phase: 'start' }] },
    { emit: ['agent.reasoning', { delta: 'Tracing the active theme and the shared animation clock.' }] },
    { wait: 600 },
    { capture: 'thinking-plif' },
  ],

  /** A real SGR mouse triple-click on the visual paste token. */
  'pasted-popup': [
    { wait: 200 },
    {
      paste: 'This is a pasted message with enough content to become a Plif Pasted attachment. It keeps the original lines so the popup can show the clipboard payload clearly and gives the preview a realistic clipboard body.\nThe second line stays available to the modal, which is why the visual token is compact while the popup keeps the complete message.\nA third line makes the interaction easy to inspect in a narrow terminal without changing the session or sending the message.',
    },
    { wait: 300 },
    { click: [14, Math.max(1, rows - 6)] },
    { click: [14, Math.max(1, rows - 6)] },
    { click: [14, Math.max(1, rows - 6)] },
    { wait: 300 },
    { capture: 'pasted-popup' },
    { type: '\u001b' },
    { wait: 200 },
    { capture: 'pasted-popup-closed-with-esc' },
  ],

  /** A compaction stage, without invoking a provider. */
  'compact-plif': [
    { wait: 200 },
    {
      emit: [
        'agent.compacting',
        { stage: 'summarising older turns', step: 2, steps: 4, before: 142_000, target: 84_000 },
      ],
    },
    { wait: 600 },
    { capture: 'compact-plif' },
  ],

  /** Start a container, run something, approve it. The everyday screen. */
  default: [
    { wait: 150 },
    { type: '/new\r' },
    { wait: 1600 },
    { type: '!cmd /c echo hello from inside the container\r' },
    { wait: 700 },
    { type: 'a' },
    { wait: 1400 },
  ],

  /** The permission prompt, reached by running something policy does not know. */
  approval: [
    { wait: 150 },
    { type: '/new\r' },
    { wait: 1600 },
    { type: '!cmd /c whoami\r' },
    { wait: 900 },
  ],

  /**
   * Output arriving live. `ping -n 6` emits a line roughly once a second, so the
   * mid-run captures show the row still spinning with partial output under it.
   */
  streaming: [
    { wait: 150 },
    { type: '/new\r' },
    { wait: 1600 },
    { type: '!cmd /c ping -n 6 127.0.0.1\r' },
    { wait: 600 },
    { type: 'a' },
    { wait: 1200 },
    { capture: 'mid-run — output streaming in, row still spinning' },
    { wait: 5000 },
  ],

  /** The command menu, opened by a bare slash. */
  completions: [{ wait: 150 }, { type: '/' }, { wait: 400 }],

  /** The read-only runtime snapshot, reached through the real slash router. */
  'status-screen': [
    { wait: 150 },
    { type: '/status' },
    { type: '\r' },
    { wait: 450 },
    { capture: 'PLIF status screen' },
  ],

  /** Settings search and navigation, using the real persisted configuration. */
  'config-screen': [
    { wait: 150 },
    { type: '/config' },
    { type: '\r' },
    { wait: 450 },
    { capture: 'PLIF config screen' },
    { type: 'model' },
    { wait: 250 },
    { capture: 'config filtered by model' },
  ],

  /** The local provider catalog, filtered without a remote provider. */
  'model-catalog': [
    { wait: 150 },
    { type: '/model\r' },
    { wait: 1500 },
    { capture: 'catálogo local com OpenCode expandido' },
    { type: 'deep' },
    { wait: 500 },
    { capture: 'filtro por provider e modelo' },
  ],

  /** The provider → model handoff, without a mascot or an oversized card. */
  'providers-plif': [
    { wait: 200 },
    { type: '/providers\r' },
    { wait: 600 },
    { capture: 'provider picker' },
    { type: '\r' },
    { wait: 900 },
    { capture: 'models scoped to the selected provider' },
  ],

  /** The effort scale stays bounded and exposes each level's descriptor. */
  'effort-plif': [
    { wait: 200 },
    { type: '/effort\r' },
    { wait: 600 },
    { capture: 'effort hierarchy' },
  ],

  /**
   * A typed, valid effort applies in place.
   *
   * The regression this watches for: `/effort plif` reopening the picker and
   * asking for the same decision twice. The correct frame is one gold
   * acknowledgement row and the signature wordmark, with no picker in sight.
   */
  'effort-plif-direct': [
    { wait: 200 },
    { type: '/effort plif' + '\r' },
    { wait: 700 },
    { capture: 'applied directly — no picker' },
    { wait: 1200 },
    { capture: 'wordmark settling' },
  ],

  /** The workspace session navigator, with real persisted metadata. */
  sessions: [
    { wait: 200 },
    { type: '/sessions\r' },
    { wait: 700 },
    { capture: 'workspace sessions — list and detail' },
    { type: '\u001b[B' },
    { wait: 300 },
    { capture: 'selected session detail' },
  ],

  /** The agent answering with markdown, tool rows, and the thinking line. */
  agent: [
    { wait: 150 },
    { type: '/new'+'\r' },
    { wait: 1800 },
    { type: 'Leia o package.json e me diga em uma frase o que este projeto e. Use **negrito** no nome.'+'\r' },
    { wait: 4000 },
    { capture: 'pensando' },
    { wait: 30000 },
  ],

  /**
   * The answer arriving a word at a time.
   *
   * A long prose reply with no tool call, captured while it is still being
   * written. The regression this catches: a blank screen behind a spinner for
   * the whole generation, then the entire answer appearing at once — which is
   * what happens the moment nothing opens a row on the first `agent.text`.
   */
  'agent-streaming': [
    { wait: 150 },
    { type: '/new' + '\r' },
    { wait: 1800 },
    {
      type:
        'Sem usar ferramenta nenhuma, escreva tres paragrafos sobre por que testes de ' +
        'integracao pegam bugs que testes unitarios nao pegam.' +
        '\r',
    },
    { wait: 8000 },
    { capture: 'primeiras frases ja na tela' },
    { wait: 2500 },
    { capture: '2.5s depois — a mesma linha, mais longa' },
    { wait: 2500 },
    { capture: 'mais 2.5s' },
    { wait: 40000 },
  ],

  /**
   * The agent driving the shell.
   *
   * The one scenario that proves tool output reaches the screen: the row is
   * opened on `agent.tool` start, streams `exec.output`, and closes with the
   * text the model was given. A regression here looks like a row with a
   * duration and nothing under it.
   */
  'agent-shell': [
    { wait: 150 },
    { type: '/new' + '\r' },
    { wait: 1800 },
    {
      type:
        'Rode um comando que liste os arquivos deste diretorio e me diga quantos arquivos existem.' +
        '\r',
    },
    { wait: 6000 },
    { type: 'a' },
    { wait: 3000 },
    { capture: 'comando rodando' },
    { wait: 25000 },
  ],

  /**
   * Dragging the window wider, mid-conversation.
   *
   * The failure this exists to catch: Ink dumps `clearTerminal + everything`
   * whenever the dynamic frame is as tall as the terminal, and on Windows that
   * escape does not touch scrollback — so the whole session appears a second
   * time and the banner scrolls out of reach.
   *
   * Widening only, because that is the reported case and the one that must be
   * clean. Shrinking costs exactly one repaint that nothing here can prevent:
   * Ink handles SIGWINCH by laying out the *existing* tree against the *new*
   * height before React has a chance to re-render smaller.
   */
  resize: [
    { wait: 150 },
    { type: '/new' + '\r' },
    { wait: 1800 },
    { type: '!cmd /c echo primeira linha' + '\r' },
    { wait: 700 },
    { type: 'a' },
    { wait: 1500 },
    { type: '!cmd /c ver' + '\r' },
    { wait: 1500 },
    { capture: 'antes de redimensionar' },
    { resize: [Math.round(columnsArg * 1.4), rows] },
    { wait: 900 },
    { capture: 'depois de redimensionar' },
  ],

  /** Resize the whole interactive surface through the requested width cycle. */
  'resize-cycle-plif': [
    { wait: 250 },
    { capture: 'idle at 120 columns' },
    { type: '/' },
    { wait: 200 },
    { resize: [80, 28] },
    { wait: 150 },
    { capture: 'command menu at 80 columns' },
    { resize: [40, 16] },
    { wait: 150 },
    { capture: 'command menu at 40 columns' },
    { type: '\u001b' },
    { type: 'draft text that must survive repeated terminal resizing' },
    { resize: [100, 36] },
    { wait: 200 },
    { capture: 'draft preserved at 100 columns' },
    {
      emit: [
        'agent.tool',
        {
          id: 'resize-stream',
          name: 'run_command',
          input: { command: 'npm test' },
          phase: 'start',
        },
      ],
    },
    { emit: ['exec.start', { command: 'npm test' }] },
    { emit: ['exec.output', { chunk: 'streamed line one\nstreamed line two\n' }] },
    { resize: [72, 20] },
    { resize: [110, 42] },
    { resize: [64, 18] },
    { resize: [100, 36] },
    { wait: 300 },
    { capture: 'streaming after rapid repeated resize' },
  ],

  /**
   * Two things that were quietly broken in the same box.
   *
   * The context gauge in the header read 0/200.0k forever — the reducer case
   * existed and nothing ever dispatched it. And a bare `t` was a shortcut, so
   * the first letter of anything starting with one was swallowed: "testa" went
   * in as "esta", with nothing on screen to say why.
   */
  'header-and-typing': [
    { wait: 150 },
    { type: '/new' + '\r' },
    { wait: 1800 },
    { type: 'testa: responda apenas a palavra pronto' + '\r' },
    { wait: 12000 },
    { capture: 'a linha digitada comeca com t, e o medidor saiu do zero' },
    { type: 'tudo bem? responda apenas sim' + '\r' },
    { wait: 12000 },
    { capture: 'segundo turno — o medidor subiu' },
  ],

  /**
   * Several tool calls in one message, and one delegated investigation.
   *
   * Two row-tracking regressions live here. Parallel calls mean several rows
   * are open at once, so an `end` matched by tool name instead of wire id
   * resolves the wrong one. And a subagent's own reads run on a private bus —
   * if they leak, the timeline fills with the noise delegating was meant to
   * remove.
   */
  parallel: [
    { wait: 150 },
    { type: '/new' + '\r' },
    { wait: 1800 },
    {
      type:
        'Leia de uma vez so os arquivos package.json e tsconfig.json, e ao mesmo tempo ' +
        'use um subagente para descobrir quantos pacotes existem em packages/.' +
        '\r',
    },
    { wait: 8000 },
    { capture: 'chamadas em paralelo, subagente rodando' },
    { wait: 45000 },
  ],

  /** The sandbox posture screen. */
  sandbox: [{ wait: 150 }, { type: '/sandbox\r' }, { wait: 500 }],

  /** Command reference. */
  help: [{ wait: 150 }, { type: '/help\r' }, { wait: 400 }],

  /** An error, to check that failures read as clearly as successes. */
  error: [
    { wait: 150 },
    { type: '/new\r' },
    { wait: 1600 },
    { type: '!vssadmin delete shadows\r' },
    { wait: 800 },
  ],

  /**
   * A block of thinking, live and then settled.
   *
   * The bug this makes visible: a `Thinking` line that never resolves, because
   * nothing closed the row when the model started answering instead.
   */
  thinking: [
    { wait: 200 },
    { emit: ['agent.thinking', { phase: 'start' }] },
    {
      emit: [
        'agent.reasoning',
        {
          delta:
            'The user is asking about the auth path. Let me trace it: the token is read in\n' +
            'middleware, verified against the JWKS cache, then attached to the request. The\n' +
            'cache has a 5 minute TTL, which would explain the intermittent 401s after a\n' +
            'key rotation — the old key is still cached.',
        },
      ],
    },
    { wait: 500 },
    { capture: 'thinking, mid-thought' },
    { emit: ['agent.thinking', { phase: 'end', durationMs: 8_400 }] },
    { wait: 300 },
    { capture: 'thought, collapsed to one blue line' },
    { type: '' },
    { wait: 300 },
    { capture: 'Ctrl+R expands it' },
  ],

  /**
   * The question dialog — the screen whose absence made profile creation hang.
   */
  question: [
    { wait: 200 },
    {
      emit: [
        'question.asked',
        {
          id: 'q1',
          text: 'Salvar o perfil de IA "revisor" para uso futuro?',
          options: [
            { value: 'sim', label: 'sim' },
            { value: 'não', label: 'não' },
          ],
          context:
            'Modelo: opencode/deepseek-v4-flash-free\n' +
            'Identidade: Você revisa código com foco em correção e segurança.\n' +
            'Sempre cita arquivo e linha.\n' +
            'Nunca aprova uma mudança sem ter lido o teste que a cobre.\n' +
            'Responde em português.\n' +
            'Prefere apontar a causa a sugerir o conserto.',
        },
      ],
    },
    { wait: 400 },
    { capture: 'the agent is asking — context folded' },
    { type: '' },
    { wait: 300 },
    { capture: 'Ctrl+E shows the whole proposal' },
    { type: 'talvez' },
    { wait: 300 },
    { capture: 'typing a free answer leaves the suggestions' },
  ],

  /**
   * The regression, end to end, against a real model.
   *
   * `create_profile` asks before writing to the global config. Nothing is saved
   * unless someone answers "sim", and this scenario never does — it exits with
   * the question outstanding, which resolves to null on shutdown. What it
   * proves is that the dialog appears at all, which for six minutes of "criando
   * o perfil" it did not.
   */
  'profile-question': [
    { wait: 150 },
    { type: '/new\r' },
    { wait: 1800 },
    {
      type:
        'Crie um perfil de IA chamado "revisor" usando create_profile, com o modelo ' +
        'opencode/deepseek-v4-flash-free e uma identidade de revisor de codigo em portugues.\r',
    },
    { wait: 45000 },
    { capture: 'o agente perguntando de verdade' },
  ],

  /**
   * Dragging the window narrower while the agent is answering.
   *
   * The exact sequence from a real session: 144 columns, then 127, then 140,
   * across one turn. Each narrowing used to leave a ghost copy of the prompt
   * box behind, because Ink re-lays-out the existing tree the instant the
   * terminal resizes — before React re-renders — and a pixel width baked into
   * that tree makes the intermediate frame wider than the terminal it is being
   * drawn into.
   *
   * What to look for: exactly one prompt box in the final frame, and a
   * `residue` count of zero in the footer.
   */
  'resize-midturn': [
    { wait: 150 },
    { type: '/new\r' },
    { wait: 1800 },
    { type: 'Opa deepseek, tudo bem?\r' },
    { wait: 2500 },
    { resize: [127, 40] },
    { wait: 900 },
    { capture: 'narrowed to 127 mid-answer' },
    { resize: [140, 40] },
    { wait: 900 },
    { capture: 'widened to 140' },
    { wait: 25000 },
  ],

  /**
   * The endpoint failing, and the wait being explained rather than endured.
   *
   * One row across all ten attempts. Ten rows would push the conversation off
   * screen to say the same thing ten times.
   */
  retry: [
    { wait: 200 },
    {
      emit: [
        'agent.retry',
        { attempt: 1, of: 10, waitMs: 5_000, reason: 'opencode.ai returned 500' },
      ],
    },
    { wait: 400 },
    { capture: 'first failure' },
    {
      emit: [
        'agent.retry',
        { attempt: 3, of: 10, waitMs: 15_000, reason: 'opencode.ai returned 500' },
      ],
    },
    { wait: 400 },
    { capture: 'third attempt — same row, longer cooldown' },
    { emit: ['agent.text', { delta: 'Recovered, and here is the answer.' }] },
    { wait: 400 },
    { capture: 'endpoint came back' },
  ],

  /** The `:name:` emoji menu, and what it expands to. */
  emoji: [
    { wait: 200 },
    { type: 'bugou de novo :so' },
    { wait: 400 },
    { capture: 'menu narrowed by ":so"' },
    { type: '\t' },
    { wait: 300 },
    { capture: 'Tab inserted the glyph' },
    { type: ' e agora :fire:' },
    { wait: 400 },
    { capture: 'typing the closing colon expands in place' },
  ],

  /**
   * Typing while the agent works, and the queue that results.
   *
   * The regression this guards: the field used to be replaced by "Esc to
   * cancel" while busy, so the only way to add a forgotten detail was to kill
   * a turn that was going fine.
   */
  queue: [
    { wait: 150 },
    { type: '/new\r' },
    { wait: 1800 },
    { type: 'Leia o package.json e resuma em uma frase.\r' },
    { wait: 2500 },
    { type: 'ah, e diz tambem qual a versao do node\r' },
    { wait: 500 },
    { type: 'esse aqui foi sem querer\r' },
    { wait: 500 },
    { capture: 'two queued, inside the prompt frame' },
    { type: '\x18' },
    { wait: 400 },
    { capture: 'Ctrl+X dropped the one the arrows pointed at' },
    { wait: 30000 },
  ],

  /**
   * Ctrl+V, against whatever is actually on the clipboard.
   *
   * Deliberately not stubbed. The clipboard is the one part of this that
   * depends on the host behaving, and a mocked one would pass on a machine
   * where the real thing returns nothing.
   */
  paste: [
    { wait: 200 },
    { type: 'olha esse erro ' },
    { type: '\x16' },
    { wait: 2500 },
    { capture: 'Ctrl+V with an image on the clipboard' },
  ],

  /**
   * The extension browser, against the live plugin marketplaces.
   *
   * Not stubbed: the catalogue is the whole point, and a fake one would pass on
   * a machine where the real fetch fails.
   */
  browser: [
    { wait: 200 },
    { type: '/mcp\r' },
    { wait: 600 },
    { capture: 'MCP tab — what this machine has' },
    { type: '\t\t' },
    { wait: 3000 },
    { capture: 'Marketplace tab, freshly fetched' },
    { type: 'postgres' },
    { wait: 600 },
    { capture: 'filtered' },
    { type: '\x1b[B\x1b[B' },
    { wait: 400 },
    { capture: 'moved down, detail follows' },
  ],

  /** The compaction bar, part-way up the ladder. */
  compaction: [
    { wait: 200 },
    {
      emit: [
        'agent.compacting',
        { stage: 'trimming tool output', step: 2, steps: 4, before: 142_000, target: 84_000 },
      ],
    },
    { wait: 400 },
    { capture: 'compacting, 2 of 4' },
    {
      emit: [
        'agent.compacting',
        { stage: 'summarising older turns', step: 4, steps: 4, before: 142_000, target: 84_000 },
      ],
    },
    { wait: 400 },
    { capture: 'the expensive stage' },
    {
      emit: [
        'agent.compacted',
        { before: 142_000, after: 61_400, stages: ['trimmed tool output', 'summarised older turns'], summarised: true },
      ],
    },
    { wait: 400 },
    { capture: 'done, with the result in the log' },
  ],

  /** Three delegated agents, as tabs. */
  subagents: [
    { wait: 200 },
    { emit: ['subagent.started', { taskId: 's1', callId: 'c1', title: 'auth trace', model: 'opencode/deepseek-v4-flash-free', at: Date.now() }] },
    { emit: ['subagent.started', { taskId: 's2', callId: 'c2', title: 'web research', model: 'opencode/longcat-2.0-free', at: Date.now() }] },
    { emit: ['subagent.started', { taskId: 's3', callId: 'c3', title: 'test sweep', model: 'opencode/deepseek-v4-flash-free', at: Date.now() }] },
    { emit: ['subagent.activity', { taskId: 's3', kind: 'thinking', label: 'start' }] },
    { emit: ['subagent.activity', { taskId: 's3', kind: 'tool', label: 'list_dir(packages/core/test)' }] },
    { emit: ['subagent.activity', { taskId: 's3', kind: 'tool', label: 'list_dir(packages/core/test)', ok: true, durationMs: 34 }] },
    { emit: ['subagent.activity', { taskId: 's3', kind: 'tool', label: 'run_command(npm test)' }] },
    { wait: 500 },
    { capture: 'three tabs, newest focused' },
    { type: '\t' },
    { wait: 300 },
    { capture: 'Tab cycles to the next one' },
    { emit: ['subagent.finished', { taskId: 's1', status: 'done', at: Date.now(), durationMs: 12_400, summary: 'The JWKS cache TTL is the cause; see auth/middleware.ts:88.' }] },
    { wait: 400 },
    { capture: 'one finished' },
  ],

  /**
   * An edit, shown as a diff.
   *
   * Emitted rather than run so the frame is the same every time — the point is
   * the rendering, not the edit.
   */
  diff: [
    { wait: 200 },
    { emit: ['agent.tool', { id: 't1', name: 'edit_file', input: { path: 'packages/cli/src/app.tsx' }, phase: 'start' }] },
    { wait: 200 },
    {
      emit: [
        'agent.tool',
        {
          id: 't1',
          name: 'edit_file',
          input: { path: 'packages/cli/src/app.tsx' },
          phase: 'end',
          ok: true,
          durationMs: 41,
          output: 'edited packages/cli/src/app.tsx — added 9 lines, removed 1 line',
          diff: [
            '--- a/packages/cli/src/app.tsx',
            '+++ b/packages/cli/src/app.tsx',
            '@@ -1608,7 +1608,15 @@',
            '   ',
            '   // ---- render ------------------------------------------------',
            '   ',
            '-  const hints: Hint[] = state.picker',
            '+  const hints: Hint[] = state.question',
            '+    ? [',
            "+        { key: 'type', label: 'answer' },",
            "+        ...(state.question.options?.length ? [{ key: '↑↓', label: 'pick' }] : []),",
            "+        { key: 'Enter', label: 'send' },",
            "+        ...(state.question.context ? [{ key: 'Ctrl+E', label: 'details' }] : []),",
            "+        { key: 'Esc', label: 'cancel turn' },",
            '+      ]',
            '+    : state.picker',
            '     ? [',
            "       { key: 'type', label: 'filter' },",
            "       { key: '↑↓', label: 'choose' },",
          ].join('\n'),
        },
      ],
    },
    { wait: 500 },
    { capture: 'Update(app.tsx) with a coloured diff' },
  ],

  /** A completed tool row, then the real raw Ctrl+E byte through Ink. */
  'tool-expand': [
    { wait: 200 },
    { emit: ['agent.tool', { id: 'expand-1', name: 'run_command', input: { command: 'printf output' }, phase: 'start' }] },
    { wait: 150 },
    {
      emit: [
        'agent.tool',
        {
          id: 'expand-1',
          name: 'run_command',
          input: { command: 'printf output' },
          phase: 'end',
          ok: true,
          output: 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8',
        },
      ],
    },
    { wait: 300 },
    { capture: 'tool collapsed before Ctrl+E' },
    { type: '\u0005' },
    { wait: 300 },
    { capture: 'tool expanded after raw Ctrl+E' },
  ],
};


const columns = columnsArg;
const scenarioName = process.argv[3] ?? 'default';
const steps = SCENARIOS[scenarioName];

if (!steps) {
  process.stderr.write(
    `unknown scenario "${scenarioName}". Available: ${Object.keys(SCENARIOS).join(', ')}\n`,
  );
  process.exit(1);
}

const stdout = new FakeStdout(columns, rows);
const stdin = new FakeStdin();

// Commands inside a scenario read and write the real global config unless it
// is pointed somewhere disposable. `/effort plif` in a preview once persisted
// into the developer's own ~/.plif/config.toml; a preview harness must never
// reach the user's machine state.
const previousConfigPath = process.env['PLIF_CONFIG_PATH'];
process.env['PLIF_CONFIG_PATH'] = path.join(os.tmpdir(), `plif-preview-config-${Date.now()}.toml`);
await fs.writeFile(process.env['PLIF_CONFIG_PATH'], '');

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-preview-'));
const engine = new Engine({ root });
const report = await engine.start();
const themeCatalogue = await loadThemes();
activateTheme(themeCatalogue.themes[0]!);
const capabilityCache = new ProviderCapabilityCache({
  file: path.join(root, 'model-capabilities.json'),
});

const { OpenAIProvider, resolveConfig, validateModelConfig } = await import('@plif/core');
const previewConfig = resolveConfig({});
const previewCheck = validateModelConfig(previewConfig);
const previewProvider = previewCheck.ok
  ? new OpenAIProvider(previewConfig, { capabilityCache, bus: engine.bus })
  : null;
const previewProblem = previewCheck.ok ? null : (previewCheck.problem ?? 'model is not configured');

const previewSession = await engine.sessions.create(process.cwd());
if (scenarioName === 'sessions') {
  const examples = [
    'PLIF experience refactor',
    'Raw input mouse bug',
    'Model navigator',
  ];
  for (const [index, title] of examples.entries()) {
    const archived = await engine.sessions.create(process.cwd());
    await archived.append({
      kind: 'user',
      at: new Date(Date.now() - (index + 1) * 45 * 60_000).toISOString(),
      text: title,
    });
    await archived.close();
  }
}

const resizeListenersBefore = new Set(
  stdout.listeners('resize') as Array<(...args: unknown[]) => void>,
);
const app = render(React.createElement(App, {
    engine,
    report,
    cwd: process.cwd(),
    session: previewSession,
    replay: [],
    version: VERSION,
    // Resolved the same way the real CLI resolves it, rather than gated on a
    // key being exported. The default model needs none, so hard-coding that
    // condition made every agent scenario preview as "no model configured" on
    // exactly the configuration most people run.
    provider: previewProvider,
    capabilityCache,
    // Plif visual scenarios are event-only; the model picker would obscure
    // the surface being previewed when this machine has no provider config.
    providerProblem: scenarioName.endsWith('-plif') || scenarioName === 'model-catalog' || scenarioName === 'pasted-popup' || scenarioName === 'sessions' || scenarioName === 'status-screen' || scenarioName === 'config-screen' || scenarioName === 'tool-expand'
      ? null
      : previewProblem,
    tools: (await import('@plif/core')).DEFAULT_TOOLS,
    skillCatalogue: '',
    mcpCatalogue: '',
    skills: [],
    mcpStatuses: [],
    ...(['idle-plif', 'working-plif', 'thinking-plif', 'compact-plif'].includes(scenarioName)
      ? { effort: 'plif' as const }
      : {}),
    initialThemeId: themeCatalogue.themes[0]?.id,
    themeCatalogue,
  }), {
  stdout: stdout as unknown as NodeJS.WriteStream,
  stdin: stdin as never,
  exitOnCtrlC: false,
  patchConsole: false,
});
detachImmediateInkResize(stdout as unknown as NodeJS.WriteStream, resizeListenersBefore);

const CLEAR_TERMINAL = '[2J';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The newest write that is actually a screen.
 *
 * Ink interleaves bare cursor-control sequences between repaints, so the last
 * chunk written is usually a lone "hide cursor" rather than the frame you want.
 */
function latestFrame(): string {
  return (
    [...stdout.frames]
      .reverse()
      .find(
        (candidate) =>
          candidate.replace(/\x1b\[[\d;?]*[a-zA-Z]/g, '').trim().length > 40,
      ) ?? '(nothing rendered)'
  );
}

/** Strip erase/home codes so captured frames stack instead of wiping each other. */
function flatten(frame: string): string {
  return frame.replace(/\x1b\[[0-9]*[JHK]/g, '').replace(/\x1b\[\d*[AG]/g, '');
}

/**
 * The first substantial write.
 *
 * Ink emits `<Static>` content once, on its own, and never repaints it — so the
 * banner never appears in the final frame and would be invisible to this
 * harness without being captured separately.
 */
function firstFrame(): string {
  return (
    stdout.frames.find(
      (candidate) => candidate.replace(/\x1b\[[\d;?]*[a-zA-Z]/g, '').trim().length > 40,
    ) ?? '(nothing rendered)'
  );
}

/**
 * Everything that scrolled past, in order.
 *
 * Most of a session now lives in `<Static>`: rows are printed once, above the
 * live frame, and never repainted. `latestFrame` cannot see any of it, so
 * without this a preview would show four rows and imply the rest was lost.
 *
 * Telling a static write from a frame is done by content, not by escapes: the
 * first frame of a run carries no erase sequence either, so the escapes alone
 * are not a reliable signal. Every frame ends in the footer — key hints when a
 * dialog owns the keyboard, the identity summary otherwise — and no committed
 * row ever contains either.
 */
const FOOTER_HINT = /(Enter|Esc|Ctrl\+C|Tab|y\/a|type):[a-z]|effort: (default|plif|low|medium|high|xhigh|max|ultra|ultracode)/;

function scrollback(): string {
  return stdout.frames
    .filter((chunk) => !chunk.includes(CLEAR_TERMINAL))
    .filter((chunk) => !FOOTER_HINT.test(chunk))
    .filter((chunk) => chunk.replace(/\x1b\[[\d;?]*[a-zA-Z]/g, '').trim().length > 0)
    .join('');
}

const captures: { label: string; frame: string }[] = [];

for (const step of steps) {
  if ('wait' in step) await sleep(step.wait);
  else if ('capture' in step) captures.push({ label: step.capture, frame: latestFrame() });
  else if ('resize' in step) stdout.resize(step.resize[0], step.resize[1]);
  else if ('paste' in step) {
    stdin.send(`\u001b[200~${step.paste}\u001b[201~`);
    await sleep(80);
  } else if ('click' in step) {
    stdin.send(`\u001b[<0;${step.click[0]};${step.click[1]}M`);
    await sleep(80);
  }
  else if ('emit' in step) {
    (engine.bus as unknown as { emit: (name: string, payload: unknown) => void }).emit(
      step.emit[0],
      step.emit[1],
    );
    await sleep(120);
  } else await stdin.type(step.type);
}
captures.unshift({ label: 'startup (static banner)', frame: firstFrame() });
captures.push({ label: 'scrollback (everything <Static> printed)', frame: scrollback() });
captures.push({ label: 'final (the live frame)', frame: latestFrame() });

const rule = '\u2500'.repeat(columns);
for (const { label, frame } of captures) {
  process.stdout.write(`\n${rule}\n${label}\n${rule}\n`);
  process.stdout.write(flatten(frame));
}
/**
 * How many times did the whole session get re-emitted?
 *
 * Ink writes `clearTerminal + everything` whenever the dynamic frame is as tall
 * as the terminal. That escape does not clear scrollback on Windows, so each
 * occurrence is one visible duplicate of the entire conversation. Counting them
 * turns "as mensagens repetem" from something you squint at into a number.
 */
const repaints = stdout.frames.filter((frame) => frame.includes(CLEAR_TERMINAL)).length;

/**
 * The height Ink compares against `rows` — at or above it, the repaint fires.
 *
 * Repaint frames are excluded: they carry the whole static backlog with them,
 * so counting those would report the backlog's size, not the frame's.
 */
if (process.env['PREVIEW_DEBUG']) {
  stdout.frames.forEach((frame, index) => {
    if (!frame.includes(CLEAR_TERMINAL)) return;
    const plain = frame.replace(/\x1b\[[\d;?]*[a-zA-Z]/g, '');
    process.stderr.write(`REPAINT frame ${index}/${stdout.frames.length} ${plain.split('\n').length} lines\n`);
    process.stderr.write(plain.split('\n').slice(-14).join('\n') + '\n---\n');
  });
}

const tallest = stdout.frames.reduce((peak, frame) => {
  if (frame.includes(CLEAR_TERMINAL)) return peak;
  // Static writes are not measured against `rows`, and a committed answer can
  // be eighty lines long — reporting that as the frame height would look like
  // a failure where there is none.
  if (!FOOTER_HINT.test(frame)) return peak;
  const height = frame.replace(/\x1b\[[\d;?]*[a-zA-Z]/g, '').split('\n').length;
  return Math.max(peak, height);
}, 0);

process.stdout.write(
  `\n${rule}\nscenario: ${scenarioName}  ·  ${columns}x${rows}  ·  ` +
    `${stdout.frames.length} frames  ·  ${repaints} full repaints  ·  ` +
    `tallest frame ${tallest} lines  ·  ${stdout.overflows.length} over-wide lines\n`,
);

// Any of these is a ghost copy waiting to happen, so name them rather than
// leaving a number to be interpreted.
for (const overflow of stdout.overflows.slice(0, 5)) {
  process.stdout.write(
    `  ! ${overflow.width} chars into a ${overflow.columns}-column terminal: ${overflow.text}\n`,
  );
}


app.unmount();
await engine.shutdown();
// Windows holds a handle briefly after the last writer closes, so a teardown
// straight after a live run hits EBUSY on a directory that is about to be free.
await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
await fs.rm(process.env['PLIF_CONFIG_PATH'], { force: true });
if (previousConfigPath === undefined) delete process.env['PLIF_CONFIG_PATH'];
else process.env['PLIF_CONFIG_PATH'] = previousConfigPath;
process.exit(0);
