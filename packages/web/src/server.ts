/**
 * Web terminal adapter — PTY bridge (hardened).
 *
 * Spawns the interactive plif CLI inside a real pseudo-terminal and ferries raw
 * bytes between that PTY and an xterm.js client over a WebSocket. The CLI is
 * untouched: it believes it is talking to an ordinary TTY.
 *
 * Security (Fase 2):
 *   - A random token is generated per server; both the page and the /pty
 *     upgrade must present it (`?token=...`).
 *   - The WebSocket upgrade checks the Origin header, so a page served from
 *     another site cannot open the terminal (CSRF-style protection).
 *   - Concurrent sessions are capped (`maxSessions`, default 1).
 *
 * The PTY itself is allocated by a Python standard-library bridge
 * (`bridge/pty-bridge.py`) rather than a native Node addon, so there is nothing
 * to compile. See `./pty.ts` for the wiring.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

import { WebSocketServer, type WebSocket } from 'ws';

import { spawnPty, type PtyProcess } from './pty.js';

export interface WebServerOptions {
  /** TCP port to listen on. */
  readonly port: number;
  /** Interface to bind. Defaults to 127.0.0.1. */
  readonly host: string;
  /** Executable to spawn inside the PTY (e.g. process.execPath). */
  readonly command: string;
  /** Arguments passed to the spawned command. */
  readonly args: readonly string[];
  /** Working directory for the spawned process. */
  readonly cwd: string;
  /** Maximum concurrent PTY sessions. Defaults to 1. */
  readonly maxSessions?: number;
  /**
   * Shared password that enables the browser login page (PLIF_WEB_PASSWORD).
   * When set, unauthenticated browsers see a login form and sign in with a
   * session cookie; the token URL keeps working as a fallback.
   */
  readonly password?: string;
}

export interface WebServerHandle {
  /** Base URL of the server, without the token. */
  readonly url: string;
  /** Secret token required to load the page and open the socket. */
  readonly token: string;
  /** The exact URL a human should open in the browser (token included). */
  readonly urlWithToken: string;
  /** Stop listening and terminate any live sessions. */
  close(): Promise<void>;
}

/** Discriminated JSON messages over the /pty socket. */
type ClientMessage =
  | { readonly t: 'in'; readonly d: string }
  | { readonly t: 'resize'; readonly cols: number; readonly rows: number };

const here = path.dirname(fileURLToPath(import.meta.url));
/** public/ sits next to dist/ in the package layout. */
const PUBLIC_DIR = path.resolve(here, '..', 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function log(message: string): void {
  process.stderr.write(`plif web: ${message}\n`);
}

function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    if (record['t'] === 'in' && typeof record['d'] === 'string') {
      return { t: 'in', d: record['d'] };
    }
    if (
      record['t'] === 'resize' &&
      typeof record['cols'] === 'number' &&
      typeof record['rows'] === 'number'
    ) {
      return { t: 'resize', cols: record['cols'], rows: record['rows'] };
    }
    return null;
  } catch {
    return null;
  }
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '0.0.0.0';
}

function tokenMatches(provided: string | null, expected: string): boolean {
  if (provided === null || provided === '') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Constant-time comparison for the shared password (compare sha256 digests). */
function secretEquals(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

/**
 * Decide whether a WebSocket Origin header is acceptable.
 *
 * Non-browser clients send no Origin and are allowed through (the token is the
 * gate for them). Browser origins must point back at this exact server, so a
 * page opened elsewhere cannot silently attach to the terminal.
 */
function originAllowed(origin: string | undefined, boundHost: string, boundPort: number): boolean {
  if (origin === undefined || origin === '') return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const originPort = Number(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'));
    if (originPort !== boundPort) return false;
    const originHost = parsed.hostname;
    if (isLoopback(boundHost)) return isLoopback(originHost);
    return originHost === boundHost;
  } catch {
    return false;
  }
}

async function serveStatic(pathname: string, res: http.ServerResponse): Promise<void> {
  const resolved = path.resolve(PUBLIC_DIR, `.${pathname}`);
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  try {
    const body = await readFile(resolved);
    const type = MIME[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}

export async function startWebServer(options: WebServerOptions): Promise<WebServerHandle> {
  const { port, host, command, args, cwd } = options;
  const maxSessions = options.maxSessions ?? 4;
  const token = randomBytes(16).toString('hex');

  let boundPort = port;

  const password = options.password !== undefined && options.password !== '' ? options.password : undefined;
  const sessions = new Set<string>();

  const sessionValid = (req: http.IncomingMessage): boolean => {
    const sid = readCookie(req.headers.cookie, 'plif_session');
    return sid !== null && sessions.has(sid);
  };

  const serveLogin = async (res: http.ServerResponse, failed: boolean): Promise<void> => {
    try {
      const html = await readFile(path.join(PUBLIC_DIR, 'login.html'));
      const body = html
        .toString('utf8')
        .replace('<!--ERROR-->', failed ? '<p class="error">Senha incorreta.</p>' : '');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('plif web: unable to read login page');
    }
  };

  const readBody = (req: http.IncomingMessage, limit = 4096): Promise<string> =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) {
          reject(new Error('body too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/login' && req.method === 'POST' && password !== undefined) {
      let provided = '';
      try {
        provided = new URLSearchParams(await readBody(req)).get('password') ?? '';
      } catch {
        provided = '';
      }
      if (provided !== '' && secretEquals(provided, password)) {
        const sid = randomBytes(16).toString('hex');
        sessions.add(sid);
        if (sessions.size > 64) {
          const oldest = sessions.values().next().value;
          if (oldest !== undefined) sessions.delete(oldest);
        }
        res.writeHead(303, {
          'Set-Cookie': `plif_session=${sid}; HttpOnly; SameSite=Lax; Path=/`,
          Location: '/',
        });
        res.end();
      } else {
        await serveLogin(res, true);
      }
      return;
    }

    if (url.pathname === '/session') {
      const ok =
        tokenMatches(url.searchParams.get('token'), token) ||
        (password !== undefined && sessionValid(req));
      res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(ok ? '{"ok":true}' : '{"ok":false}');
      return;
    }

    if (url.pathname === '/' || url.pathname === '') {
      const viaToken = tokenMatches(url.searchParams.get('token'), token);
      const viaSession = password !== undefined && sessionValid(req);
      if (viaToken || viaSession) {
        await serveStatic('/index.html', res);
        return;
      }
      if (password !== undefined) {
        await serveLogin(res, false);
        return;
      }
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('plif web: missing or invalid token');
      return;
    }
    // Static assets (vendor bundles, etc.) are not secret; only the page is.
    await serveStatic(url.pathname, res);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const destroy = (statusLine: string): void => {
      socket.write(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (url.pathname !== '/pty') {
      destroy('404 Not Found');
      return;
    }
    const viaSession = password !== undefined && sessionValid(req);
    if (!tokenMatches(url.searchParams.get('token'), token) && !viaSession) {
      destroy('401 Unauthorized');
      return;
    }
    if (!originAllowed(req.headers.origin, host === '0.0.0.0' ? 'localhost' : host, boundPort)) {
      destroy('403 Forbidden');
      return;
    }
    if (wss.clients.size >= maxSessions) {
      log(`rejecting upgrade: session limit reached (${maxSessions} live)`);
      destroy('503 Service Unavailable');
      return;
    }
    wss.handleUpgrade(req, socket, head, (socket: WebSocket) => {
      wss.emit('connection', socket, req);
    });
  });

  wss.on('connection', (socket: WebSocket) => {
    log('session started');

    // Keepalive: reap half-dead sockets (laptop sleep, Tailscale rekey) so a
    // zombie connection can never hold a session slot forever.
    let alive = true;
    socket.on('pong', () => {
      alive = true;
    });
    const ping = setInterval(() => {
      if (!alive) {
        log('session unresponsive — terminating');
        socket.terminate();
        return;
      }
      alive = false;
      if (socket.readyState === socket.OPEN) socket.ping();
    }, 30_000);

    const term: PtyProcess = spawnPty(command, args, {
      cols: 80,
      rows: 24,
      cwd,
    });

    const send = (payload: Record<string, unknown>): void => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
    };

    term.onData((data: string) => send({ t: 'out', d: data }));
    term.onExit(({ exitCode }: { readonly exitCode: number }) => {
      log(`pty exited with code ${exitCode}`);
      send({ t: 'exit', code: exitCode });
      socket.close();
    });

    socket.on('message', (raw: Buffer | string) => {
      const message = parseClientMessage(raw.toString());
      if (message === null) return;
      if (message.t === 'in') term.write(message.d);
      else if (message.t === 'resize') term.resize(message.cols, message.rows);
    });

    socket.on('close', () => {
      clearInterval(ping);
      log('session closed');
      try {
        term.kill();
      } catch {
        // The process may already be gone; nothing to clean up.
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  boundPort = address.port;
  const baseHost = host === '0.0.0.0' ? 'localhost' : host;
  const url = `http://${baseHost}:${address.port}`;

  return {
    url,
    token,
    urlWithToken: `${url}/?token=${token}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => {
          server.close(() => resolve());
        });
      }),
  };
}
