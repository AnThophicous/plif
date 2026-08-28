#!/usr/bin/env node
/**
 * Minimal CLI dispatcher.
 *
 * Keep version/help/error paths dependency-light. The engine, Ink and React
 * are loaded only by the command that needs them, so boot diagnostics remain
 * fast and non-interactive invocations never construct the interactive tree.
 */

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { HELP_TOPICS, USAGE, parseArgv } from './argv.js';
import { VERSION_LABEL } from './version.js';

function loadEnvironment(cwd = process.cwd()): void {
  const candidates = [
    path.join(cwd, '.env'),
    path.join(os.homedir(), '.plif', '.env'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        if (typeof process.loadEnvFile === 'function') {
          process.loadEnvFile(candidate);
        } else {
          const content = readFileSync(candidate, 'utf8');
          for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIndex = trimmed.indexOf('=');
            if (eqIndex === -1) continue;
            const key = trimmed.slice(0, eqIndex).trim();
            let val = trimmed.slice(eqIndex + 1).trim();
            if (
              (val.startsWith('"') && val.endsWith('"')) ||
              (val.startsWith("'") && val.endsWith("'"))
            ) {
              val = val.slice(1, -1);
            }
            if (!(key in process.env)) {
              process.env[key] = val;
            }
          }
        }
      } catch {
        // Silently continue if .env cannot be read
      }
    }
  }
}

async function main(): Promise<void> {
  loadEnvironment();
  const invocation = parseArgv(process.argv.slice(2), process.cwd());

  switch (invocation.kind) {
    case 'version':
      process.stdout.write(`plif ${VERSION_LABEL}\n`);
      return;

    case 'help': {
      const topic = invocation.topic;
      if (topic && HELP_TOPICS[topic]) {
        process.stdout.write(HELP_TOPICS[topic]);
      } else if (topic) {
        process.stderr.write(
          `plif: no help topic "${topic}". Available: ${Object.keys(HELP_TOPICS).join(', ')}\n`,
        );
        process.exitCode = 1;
      } else {
        process.stdout.write(USAGE);
      }
      return;
    }

    case 'error':
      process.stderr.write(`plif: ${invocation.message}\n`);
      if (invocation.hint) process.stderr.write(`      ${invocation.hint}\n`);
      process.exitCode = 2;
      return;

    case 'sessions':
      return await (await import('./commands/sessions.js')).runSessions(invocation);
    case 'sandbox':
      return await (await import('./commands/sandbox.js')).runSandbox(invocation);
    case 'model':
      return await (await import('./commands/model.js')).runModel(invocation);
    case 'skills':
      return await (await import('./commands/skills.js')).runSkills(invocation);
    case 'mcp':
      return await (await import('./commands/mcp.js')).runMcp(invocation);
    case 'web':
      return await (await import('./commands/web.js')).runWeb(invocation);
    case 'prompt':
      return await (await import('./commands/prompt.js')).runPrompt(invocation);
    case 'continue':
    case 'resume':
    case 'interactive':
      return await (await import('./commands/interactive.js')).runInteractive(invocation);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`plif: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
