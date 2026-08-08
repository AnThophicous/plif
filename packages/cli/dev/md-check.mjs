import { EventEmitter } from 'node:events';
import React from 'react';

process.env.COLORTERM = 'truecolor';
process.env.WT_SESSION = 'md';
process.env.FORCE_COLOR = '3';

const { render } = await import('ink');
const { Markdown } = await import('../dist/components/Markdown.js');

class Out extends EventEmitter {
  columns = 76;
  rows = 40;
  isTTY = true;
  frames = [];
  write(c) {
    this.frames.push(c);
    return true;
  }
  end() {}
}

const SAMPLE = `The bug is in \`src/calc.js\`: **soma returns \`a - b\` instead of \`a + b\`**.

## What happens

The test calls \`soma(2, 2)\` and expects \`4\`, but gets \`0\`:

\`\`\`js
export function soma(a, b) { return a - b; }
\`\`\`

Fix it by swapping the operator:

- Change \`-\` to \`+\` on line 1
- Re-run \`node test.js\` to confirm

> Nothing else in the file depends on the old behaviour.

This is a *long paragraph* that should wrap cleanly at the width given to it, keeping **bold spans blue across the line break** so emphasis does not vanish halfway through the sentence it applies to.`;

const out = new Out();
const app = render(React.createElement(Markdown, { source: SAMPLE, width: 72 }), {
  stdout: out,
  exitOnCtrlC: false,
  patchConsole: false,
});

await new Promise((r) => setTimeout(r, 200));
const frame = [...out.frames].reverse().find((f) => f.trim().length > 40) ?? '(nada)';
process.stdout.write(frame.replace(/\x1b\[[0-9]*[JHK]/g, ''));
app.unmount();
process.exit(0);
