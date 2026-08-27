import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import WebSocket from 'ws';

import { startWebServer, type WebServerHandle } from '../src/index.js';

const TEST_PORT = 4713;
const TEST_HOST = '127.0.0.1';

/**
 * Integration tests for the web terminal adapter.
 *
 * These spawn a real PTY bridge with `/bin/sh` as the child process, so they
 * validate the full stack: HTTP token gate → WebSocket upgrade → PTY I/O.
 * Requires python3 on PATH (the PTY bridge).
 */
describe('web server — token enforcement', () => {
  let handle: WebServerHandle;

  after(async () => {
    if (handle) await handle.close();
  });

  it('rejects the page without a token (401)', async () => {
    handle = await startWebServer({
      port: TEST_PORT,
      host: TEST_HOST,
      command: '/bin/sh',
      args: [],
      cwd: process.cwd(),
    });

    const res = await fetch(`${handle.url}/`);
    assert.equal(res.status, 401);
  });

  it('rejects the page with a wrong token (401)', async () => {
    const res = await fetch(`${handle.url}/?token=wrong`);
    assert.equal(res.status, 401);
  });

  it('serves the page with the correct token (200)', async () => {
    const res = await fetch(`${handle.url}/?token=${handle.token}`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes('plif'));
  });

  it('rejects a WebSocket upgrade without a token', async () => {
    const ws = new WebSocket(`ws://${TEST_HOST}:${TEST_PORT}/pty`);
    const result = await new Promise<string>((resolve) => {
      ws.on('open', () => resolve('open'));
      ws.on('error', (err) => resolve(`error:${err.message}`));
      ws.on('unexpected-response', (_req, res) => resolve(`http:${res.statusCode}`));
    });
    assert.equal(result, 'http:401');
    ws.close();
  });

  it('rejects a WebSocket upgrade with a wrong token', async () => {
    const ws = new WebSocket(`ws://${TEST_HOST}:${TEST_PORT}/pty?token=bad`);
    const result = await new Promise<string>((resolve) => {
      ws.on('open', () => resolve('open'));
      ws.on('error', (err) => resolve(`error:${err.message}`));
      ws.on('unexpected-response', (_req, res) => resolve(`http:${res.statusCode}`));
    });
    assert.equal(result, 'http:401');
    ws.close();
  });
});

describe('web server — WebSocket protocol', () => {
  let handle: WebServerHandle;

  after(async () => {
    if (handle) await handle.close();
  });

  it('spawns a shell and relays output through the protocol', async () => {
    handle = await startWebServer({
      port: TEST_PORT + 1,
      host: TEST_HOST,
      command: '/bin/sh',
      args: [],
      cwd: process.cwd(),
      maxSessions: 2,
    });

    const ws = new WebSocket(`ws://${TEST_HOST}:${TEST_PORT + 1}/pty?token=${handle.token}`);
    const output: string[] = [];

    const done = await new Promise<string>((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ t: 'in', d: 'echo PROTOCOL_OK\n' }));
        ws.send(JSON.stringify({ t: 'in', d: 'exit\n' }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.t === 'out') output.push(msg.d);
        else if (msg.t === 'exit') resolve('exit:' + msg.code);
      });
      ws.on('close', () => resolve('closed'));
      setTimeout(() => resolve('timeout'), 8000);
    });

    assert.ok(done.startsWith('exit:'), `expected exit message, got: ${done}`);
    const combined = output.join('');
    assert.ok(combined.includes('PROTOCOL_OK'), 'shell output should contain PROTOCOL_OK');
  });

  it('handles resize messages without error', async () => {
    const ws = new WebSocket(`ws://${TEST_HOST}:${TEST_PORT + 1}/pty?token=${handle.token}`);

    const result = await new Promise<string>((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ t: 'resize', cols: 120, rows: 40 }));
        ws.send(JSON.stringify({ t: 'in', d: 'exit\n' }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.t === 'exit') resolve('exit:' + msg.code);
      });
      ws.on('close', () => resolve('closed'));
      setTimeout(() => resolve('timeout'), 8000);
    });

    assert.ok(result.startsWith('exit:'), `expected clean exit after resize, got: ${result}`);
  });
});

describe('web server — session limit', () => {
  let handle: WebServerHandle;

  after(async () => {
    if (handle) await handle.close();
  });

  it('rejects a second connection when maxSessions is 1', async () => {
    handle = await startWebServer({
      port: TEST_PORT + 2,
      host: TEST_HOST,
      command: '/bin/sh',
      args: [],
      cwd: process.cwd(),
      maxSessions: 1,
    });

    const ws1 = new WebSocket(`ws://${TEST_HOST}:${TEST_PORT + 2}/pty?token=${handle.token}`);
    await new Promise<void>((resolve) => {
      ws1.on('open', resolve);
    });

    const ws2 = new WebSocket(`ws://${TEST_HOST}:${TEST_PORT + 2}/pty?token=${handle.token}`);
    const result = await new Promise<string>((resolve) => {
      ws2.on('open', () => resolve('open'));
      ws2.on('unexpected-response', (_req, res) => resolve(`http:${res.statusCode}`));
      ws2.on('error', (err) => resolve(`error:${err.message}`));
      setTimeout(() => resolve('timeout'), 5000);
    });

    assert.equal(result, 'http:503');
    ws1.close();
    ws2.close();
  });
});

describe('web server — origin check', () => {
  let handle: WebServerHandle;

  after(async () => {
    if (handle) await handle.close();
  });

  it('rejects a WebSocket with a foreign Origin header', async () => {
    handle = await startWebServer({
      port: TEST_PORT + 3,
      host: TEST_HOST,
      command: '/bin/sh',
      args: [],
      cwd: process.cwd(),
    });

    const ws = new WebSocket(`ws://${TEST_HOST}:${TEST_PORT + 3}/pty?token=${handle.token}`, {
      headers: { Origin: 'http://evil.example.com' },
    });

    const result = await new Promise<string>((resolve) => {
      ws.on('open', () => resolve('open'));
      ws.on('unexpected-response', (_req, res) => resolve(`http:${res.statusCode}`));
      ws.on('error', (err) => resolve(`error:${err.message}`));
      setTimeout(() => resolve('timeout'), 5000);
    });

    assert.equal(result, 'http:403');
    ws.close();
  });

  it('accepts a WebSocket with the correct Origin header', async () => {
    const ws = new WebSocket(`ws://${TEST_HOST}:${TEST_PORT + 3}/pty?token=${handle.token}`, {
      headers: { Origin: `http://${TEST_HOST}:${TEST_PORT + 3}` },
    });

    const result = await new Promise<string>((resolve) => {
      ws.on('open', () => resolve('open'));
      ws.on('unexpected-response', (_req, res) => resolve(`http:${res.statusCode}`));
      ws.on('error', (err) => resolve(`error:${err.message}`));
      setTimeout(() => resolve('timeout'), 5000);
    });

    assert.equal(result, 'open');
    ws.send(JSON.stringify({ t: 'in', d: 'exit\n' }));
    await new Promise<void>((resolve) => {
      ws.on('close', resolve);
      setTimeout(resolve, 3000);
    });
  });
});
