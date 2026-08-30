import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import React from 'react';

process.env.COLORTERM = 'truecolor';
process.env.WT_SESSION = 'smoke';
process.env.FORCE_COLOR = '3';

const { render } = await import('../dist/ui.js');
const { Engine, DEFAULT_TOOLS, SkillRegistry, skillTool } = await import('@plif/core');
const { App } = await import('../dist/app.js');
const { startInteractiveSurface } = await import('../dist/startup.js');
const { VERSION, VERSION_LABEL } = await import('../dist/version.js');
const { loadThemes, activateTheme } = await import('../dist/themes.js');

class Out extends EventEmitter {
  constructor(columns, rows) {
    super();
    this.columns = columns;
    this.rows = rows;
    this.isTTY = true;
    this.frames = [];
  }
  write(chunk) {
    this.frames.push(chunk);
    return true;
  }
  end() {}
}

class In extends Readable {
  isTTY = true;
  _read() {}
  setRawMode() { return this; }
  ref() { return this; }
  unref() { return this; }
  async type(text, delay = 5) {
    for (const char of text) {
      this.push(char);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

const strip = (s) => s.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;?]*[a-zA-Z]', 'g'), '');

async function trial(rows) {
  const out = new Out(60, rows);
  const stdin = new In();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-smoke-'));
  const engine = new Engine({ root });
  const report = await engine.start();
  const themeCatalogue = await loadThemes();
  activateTheme(themeCatalogue.themes[0]);
  startInteractiveSurface(out, { version: VERSION_LABEL, workspace: process.cwd() });
  const skills = await SkillRegistry.load({ workspace: process.cwd(), root });

  const app = render(
    React.createElement(App, {
      engine, report, cwd: process.cwd(),
      session: null, replay: [], version: VERSION, provider: null,
      providerProblem: 'preview has no configured model',
      tools: [...DEFAULT_TOOLS, skillTool(skills)],
      skillCatalogue: skills.catalogue(),
      mcpCatalogue: '',
      skills: skills.list(),
      mcpStatuses: [],
      initialThemeId: themeCatalogue.themes[0]?.id,
      themeCatalogue,
    }),
    { stdout: out, stdin, exitOnCtrlC: false, patchConsole: false },
  );

  await new Promise((r) => setTimeout(r, 150));
  await stdin.type('/help\r');
  await new Promise((r) => setTimeout(r, 700));
  await stdin.type('opa tudo bem\r');
  await new Promise((r) => setTimeout(r, 900));

  const all = strip(out.frames.join(''));
  const frameOutput = strip(out.frames.join(''));
  const inFrame = (frameOutput.match(new RegExp(`Plif ${VERSION_LABEL.replaceAll('.', '\\.')}`, 'g')) || []).length;
  const routed = /no model configured/.test(all);
  const spawned = /ENOENT/.test(all);

  console.log(
    `rows=${String(rows).padEnd(4)} banner-dentro-do-frame=${inFrame}  ` +
      `texto-foi-pro-agente=${routed ? 'sim' : 'NAO'}  tentou-spawn=${spawned ? 'SIM' : 'nao'}`,
  );

  app.unmount();
  await engine.shutdown();
  await fs.rm(root, { recursive: true, force: true });
  return out.frames[0] ?? '';
}

for (const rows of [40, 20, 12, 8]) await trial(rows);
console.log('\n--- banner impresso uma vez, fora do frame Slate ---');
process.stdout.write(await trial(24));
process.exit(0);
