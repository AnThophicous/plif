#!/usr/bin/env node
/**
 * Minimal CLI dispatcher.
 *
 * Keep version/help/error paths dependency-light. The engine, Ink and React
 * are loaded only by the command that needs them, so boot diagnostics remain
 * fast and non-interactive invocations never construct the interactive tree.
 */

import process from 'node:process';

import { HELP_TOPICS, USAGE, parseArgv } from './argv.js';
import { VERSION_LABEL } from './version.js';

async function main(): Promise<void> {
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
