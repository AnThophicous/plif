import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import { DEFAULT_TOOLS, Engine, saveStoredConfig } from '@plif/core';
import { render } from 'ink';
import React from 'react';

import { App } from '../src/app.js';
import { MINIMAL_THEME } from '../src/themes.js';

class CaptureOutput extends EventEmitter {
  columns = 100;
  rows = 30;
  isTTY = true as const;
  output = '';

  write(chunk: string | Uint8Array): boolean {
    this.output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }
}

class TypedInput extends Readable {
  isTTY = true as const;

  _read(): void {}

  setRawMode(): this {
    return this;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  async type(text: string): Promise<void> {
    for (const character of text) {
      this.push(character);
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }
  }
}

test('/model can request a missing provider key from the mounted app', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-model-picker-'));
  const engine = new Engine({ root });
  const report = await engine.start();
  await saveStoredConfig(engine.paths, {
    preset: 'nvidia',
    model: 'z-ai/glm-5.2',
  });

  const stdout = new CaptureOutput();
  const stdin = new TypedInput();
  const asked: string[] = [];
  const askedPromise = new Promise<void>((resolve) => {
    engine.bus.on('question.asked', (event) => {
      asked.push(event.text);
      engine.questions.answer(event.id, asked.length === 1 ? 'test-key' : 'cancel');
      if (asked.length === 2) resolve();
    });
  });
  const app = render(
    React.createElement(App, {
      engine,
      report,
      cwd: process.cwd(),
      session: null,
      replay: [],
      version: '0.3.0',
      provider: null,
      providerProblem: 'preview unavailable',
      tools: DEFAULT_TOOLS,
      skillCatalogue: '',
      mcpCatalogue: '',
      skills: [],
      mcpStatuses: [],
      themeCatalogue: { themes: [MINIMAL_THEME], problems: [] },
    }),
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  try {
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    await stdin.type('/model z-ai/glm-5.2\r');
    await Promise.race([
      askedPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`model key prompt timed out\n${stdout.output}`)), 2_000)),
    ]);
    assert.match(asked[0] ?? '', /API key · NVIDIA NIM \/ z-ai\/glm-5\.2/);
    assert.match(asked[1] ?? '', /Use this key for NVIDIA NIM \/ z-ai\/glm-5\.2/);
  } finally {
    app.unmount();
    await engine.shutdown();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
