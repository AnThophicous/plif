import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import {
  CredentialBroker,
  DEFAULT_TOOLS,
  Engine,
  saveStoredConfig,
} from '@plif/core';
import { render } from 'ink';
import React from 'react';

import { App, needsCredentialPrompt } from '../src/app.js';
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

const unavailableCredentialStore = {
  async get(): Promise<string | undefined> { throw new Error('store unavailable'); },
  async set(): Promise<void> { throw new Error('store unavailable'); },
  async delete(): Promise<void> { throw new Error('store unavailable'); },
  async names(): Promise<string[]> { return []; },
};

async function waitFor(check: () => boolean | Promise<boolean>, message: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

test('/model can request a missing provider key from the mounted app', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-model-picker-'));
  const previousConfigPath = process.env['PLIF_CONFIG_PATH'];
  process.env['PLIF_CONFIG_PATH'] = path.join(root, 'config.toml');
  const engine = new Engine({ root });
  const report = await engine.start();
  await saveStoredConfig(engine.paths, {
    preset: 'nvidia',
    model: 'z-ai/glm-5.2',
  });

  const stdout = new CaptureOutput();
  const stdin = new TypedInput();
  let asked = '';
  const askedPromise = new Promise<void>((resolve) => {
    engine.bus.on('question.asked', (event) => {
      asked = event.text;
      engine.questions.answer(event.id, 'test-key');
      resolve();
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
    // Ink can take longer than one scheduler tick to attach input while the
    // full suite is starting hundreds of tests. Wait for the mounted prompt
    // instead of sending keystrokes into a stream nobody is reading yet.
    await waitFor(
      () => stdout.output.includes('describe a task, or / for commands'),
      `app prompt did not mount\n${stdout.output}`,
    );
    // The first paint and ink's stdin attachment are separate effects, and
    // keystrokes pushed into the gap are dropped silently. Let the mount
    // settle before typing.
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    await stdin.type('/model z-ai/glm-5.2\r');
    await Promise.race([
      askedPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`model key prompt timed out\n${stdout.output}`)), 10_000)),
    ]);
    assert.match(asked, /API key required for z-ai\/glm-5\.2/);
  } finally {
    app.unmount();
    await engine.shutdown();
    if (previousConfigPath === undefined) delete process.env['PLIF_CONFIG_PATH'];
    else process.env['PLIF_CONFIG_PATH'] = previousConfigPath;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('/model shows the free OpenCode path and selects it without a key', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-free-model-picker-'));
  const previousConfigPath = process.env['PLIF_CONFIG_PATH'];
  process.env['PLIF_CONFIG_PATH'] = path.join(root, 'config.toml');
  const engine = new Engine({ root });
  const report = await engine.start();
  const stdout = new CaptureOutput();
  const stdin = new TypedInput();
  let asked = 0;
  const offQuestion = engine.bus.on('question.asked', () => { asked += 1; });
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
    await waitFor(() => stdout.output.includes('describe a task, or / for commands'), 'app prompt did not mount');
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    await stdin.type('/model\r');
    await waitFor(() => stdout.output.includes('6 available') && /no key|free/i.test(stdout.output), `free model picker did not open\n${stdout.output}`);
    assert.doesNotMatch(stdout.output, /GPT-4o|Claude Opus|NVIDIA NIM/);
    await stdin.type('\r');
    await waitFor(() => stdout.output.includes('deepseek-v4-flash-free'), `free model was not selected\n${stdout.output}`);
    assert.equal(asked, 0, 'the anonymous OpenCode path must not open an API-key prompt');
  } finally {
    offQuestion();
    app.unmount();
    await engine.shutdown();
    if (previousConfigPath === undefined) delete process.env['PLIF_CONFIG_PATH'];
    else process.env['PLIF_CONFIG_PATH'] = previousConfigPath;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('/model keeps the free path usable when the credential store is unavailable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-free-model-store-'));
  const previousConfigPath = process.env['PLIF_CONFIG_PATH'];
  process.env['PLIF_CONFIG_PATH'] = path.join(root, 'config.toml');
  const engine = new Engine({ root });
  const report = await engine.start();
  const stdout = new CaptureOutput();
  const stdin = new TypedInput();
  let asked = 0;
  const offQuestion = engine.bus.on('question.asked', () => { asked += 1; });
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
      credentials: new CredentialBroker({ store: unavailableCredentialStore }),
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
    await waitFor(() => stdout.output.includes('describe a task, or / for commands'), 'app prompt did not mount');
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    await stdin.type('/model\r');
    await waitFor(() => stdout.output.includes('6 available'), `free model picker did not open\n${stdout.output}`);
    await stdin.type('\r');
    await waitFor(() => stdout.output.includes('deepseek-v4-flash-free'), `free model was not selected\n${stdout.output}`);
    assert.equal(asked, 0);
    assert.doesNotMatch(stdout.output, /could not read the credential store/);
  } finally {
    offQuestion();
    app.unmount();
    await engine.shutdown();
    if (previousConfigPath === undefined) delete process.env['PLIF_CONFIG_PATH'];
    else process.env['PLIF_CONFIG_PATH'] = previousConfigPath;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('startup credential failures are treated as a modal gate', () => {
  assert.equal(needsCredentialPrompt('API key required for z-ai/glm-5.2'), true);
  assert.equal(needsCredentialPrompt('no model configured yet'), false);
  assert.equal(needsCredentialPrompt(null), false);
});
