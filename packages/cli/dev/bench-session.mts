/**
 * Session-open benchmark.
 *
 * Measures the real cost of opening a stored session: read, parse, transcript
 * rebuild, timeline rebuild, first Slate frame, and the cost of a subsequent
 * keystroke-sized repaint. Run:
 *
 *   node --import tsx packages/cli/dev/bench-session.mts <session.jsonl> [columns] [rows]
 */
import './force-color.mjs';

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import React from 'react';

import { render, Box, Text } from '../src/ui.js';
import { Timeline, timelineEntriesFromEvents } from '../src/components/Timeline.js';
import { activateTheme, loadThemes } from '../src/themes.js';

const file = process.argv[2]!;
const columns = Number(process.argv[3] ?? 120);
const rows = Number(process.argv[4] ?? 40);

class Out extends EventEmitter {
  columns = columns;
  rows = rows;
  isTTY = true as const;
  bytes = 0;
  frames = 0;
  last = '';
  all: string[] = [];
  write(chunk: string): boolean { this.frames += 1; this.bytes += chunk.length; this.last = chunk; this.all.push(chunk); return true; }
  end(): void {}
}
class In extends Readable {
  isTTY = true as const;
  override _read(): void {}
  setRawMode(): this { return this; }
  override ref(): this { return this; }
  override unref(): this { return this; }
}

const ms = (t: bigint): string => (Number(process.hrtime.bigint() - t) / 1e6).toFixed(1);
const mark = (): bigint => process.hrtime.bigint();

let t = mark();
const raw = fs.readFileSync(file, 'utf8');
const readMs = ms(t);

t = mark();
const events = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
const parseMs = ms(t);

t = mark();
const allEntries = timelineEntriesFromEvents(events);
const keep = Number(process.env.BENCH_KEEP ?? 0);
const entries = keep > 0 ? allEntries.slice(-keep) : allEntries;
const buildMs = ms(t);

await loadThemes();
activateTheme('default');

const out = new Out();
const stdin = new In();

let setTick: (n: number) => void = () => {};
function Harness(): React.ReactElement {
  const [tick, set] = React.useState(0);
  setTick = set;
  return React.createElement(
    Box,
    { flexDirection: 'column' },
    React.createElement(Timeline, { entries, width: columns, maxLines: Math.max(1, rows - 6) }),
    React.createElement(Text, null, `draft${'x'.repeat(tick % 7)}`),
  );
}

t = mark();
const app = render(React.createElement(Harness), { stdout: out as never, stdin: stdin as never });
const firstRenderMs = ms(t);
await new Promise((r) => setTimeout(r, 120));

// Keystroke-sized repaints: only the draft line changes.
const KEYS = Number(process.env.BENCH_KEYS ?? 40);
const cpuBefore = process.cpuUsage();
const wallBefore = mark();
for (let i = 1; i <= KEYS; i += 1) {
  setTick(i);
  await new Promise((r) => setTimeout(r, 40));
}
const cpuDelta = process.cpuUsage(cpuBefore);
const wallDelta = Number(process.hrtime.bigint() - wallBefore) / 1e6;

// Idle: no state change at all. Any CPU burned here is work with no cause.
const idleCpuBefore = process.cpuUsage();
await new Promise((r) => setTimeout(r, 1000));
const idleCpu = process.cpuUsage(idleCpuBefore);
if (process.env.PLIF_DEBUG_LAYOUT) {
  const walk = (n: any, d = 0): void => {
    if (d < 4) process.stderr.write(`${'  '.repeat(d)}${n.type} h=${JSON.stringify(n.props?.height ?? n.props?.style?.height)} kids=${(n.children??[]).length} txt=${String(n.props?.children ?? '').slice(0,20)}
`);
    for (const c of n.children ?? []) walk(c, d + 1);
  };
  walk((globalThis as any).__slate.getTree());
}
if (process.env.BENCH_DUMP) process.stderr.write(process.env.BENCH_ALL ? out.all.map((f,i)=>`
===FRAME ${i}===
`+f).join('') : out.last);
app.unmount();

console.log(JSON.stringify({
  file,
  bytes: raw.length,
  events: events.length,
  entries: entries.length,
  'read.ms': Number(readMs),
  'parse.ms': Number(parseMs),
  'timeline.build.ms': Number(buildMs),
  'ui.first-render.ms': Number(firstRenderMs),
  'keystroke.cpu.ms.each': Number(((cpuDelta.user + cpuDelta.system) / 1000 / KEYS).toFixed(1)),
  'keystroke.wall.ms.each': Number((wallDelta / KEYS - 40).toFixed(1)),
  'idle.cpu.ms.per.s': Number(((idleCpu.user + idleCpu.system) / 1000).toFixed(1)),
  frames: out.frames,
  frameBytes: out.bytes,
}, null, 2));
