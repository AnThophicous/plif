/**
 * `plif web` — serve the interactive CLI in a browser.
 *
 * This is a thin adapter: it resolves this CLI's own entrypoint, then hands
 * `@plif/web` the command to run inside a real PTY. The interactive session is
 * spawned exactly as if someone had typed `plif` in a terminal, so no CLI code
 * changes were needed.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import type { Invocation } from '../argv.js';

interface ResolvedEntrypoint {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * Find how to launch this same CLI interactively.
 *
 * From dist/commands/web.js the built entrypoint is ../main.js. Under tsx dev
 * it is ../main.tsx, launched through the tsx loader so JSX/TS run uncompiled.
 */
function resolveEntrypoint(): ResolvedEntrypoint {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const built = path.resolve(here, '..', 'main.js');
  if (existsSync(built)) {
    return { command: process.execPath, args: [built] };
  }
  const source = path.resolve(here, '..', 'main.tsx');
  if (existsSync(source)) {
    return { command: process.execPath, args: ['--import', 'tsx', source] };
  }
  throw new Error('plif web: could not locate the interactive CLI entrypoint');
}

export async function runWeb(invocation: Extract<Invocation, { kind: 'web' }>): Promise<void> {
  const { startWebServer } = await import('@plif/web');

  const { command, args } = resolveEntrypoint();
  const password = process.env['PLIF_WEB_PASSWORD'] ?? '';

  const handle = await startWebServer({
    port: invocation.port,
    host: invocation.host,
    command,
    args,
    cwd: invocation.flags.workspace,
    maxSessions: invocation.maxSessions,
    password: password === '' ? undefined : password,
  });

  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(invocation.host);
  if (!loopback) {
    process.stdout.write(
      `plif web: WARNING — bound to non-loopback host '${invocation.host}'. ` +
        'Anyone on the network who has the token URL gets a shell.\n',
    );
  }

  if (password !== '') {
    process.stdout.write(`plif web: login enabled (PLIF_WEB_PASSWORD) — open ${handle.url}/ and sign in.\n`);
    process.stdout.write(`plif web: token URL fallback:\nplif web:   ${handle.urlWithToken}\n`);
  } else {
    process.stdout.write('plif web: open this URL in your browser:\n');
    process.stdout.write(`plif web:   ${handle.urlWithToken}\n`);
  }
  process.stdout.write('plif web: the token is secret — do not share it.\n');
  process.stdout.write('plif web: press Ctrl+C here to stop the server.\n');

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      void handle.close().finally(resolve);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}
