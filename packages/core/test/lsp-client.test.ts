import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { LspClient } from '../src/lsp/client.js';
import { LspManager } from '../src/lsp/manager.js';
import { resolveServer, serverFor } from '../src/lsp/servers.js';
import type { ResolvedServer, ServerSpec } from '../src/lsp/servers.js';

const FAKE_SERVER = fileURLToPath(new URL('./fixtures/fake-lsp-server.mjs', import.meta.url));
const STALE_VERSION_SERVER = fileURLToPath(new URL('./fixtures/stale-version-lsp-server.mjs', import.meta.url));

describe('LspClient document synchronization', () => {
  it('waits for settled diagnostics and does not resend unchanged text', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-lsp-client-'));
    const file = path.join(root, 'index.ts');
    await fs.writeFile(file, 'const broken: string = 1;\n');
    const spec = serverFor(file);
    assert.ok(spec);
    const client = new LspClient({
      spec,
      command: process.execPath,
      args: [FAKE_SERVER],
      source: 'test',
    }, root);

    try {
      await client.start();
      const first = await client.diagnose(file);
      assert.equal(first.length, 1);
      assert.match(
        first[0]?.message ?? '',
        /delayed diagnostic; configuration entries: 2; workspace folders: 1/,
      );

      const second = await client.diagnose(file);
      assert.deepEqual(second, first);
    } finally {
      await client.stop();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('gets real TypeScript diagnostics from the bundled server', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-lsp-typescript-'));
    const file = path.join(root, 'index.ts');
    await fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }));
    await fs.writeFile(file, 'const value: string = 42;\n');
    const spec = serverFor(file);
    assert.ok(spec);
    const resolved = await resolveServer(spec, root);
    assert.ok(resolved);
    assert.equal(resolved.source, 'bundled');
    const client = new LspClient({
      ...resolved,
      args: [...resolved.args, '--log-level', '4'],
    }, root);

    try {
      await client.start();
      const diagnostics = await client.diagnose(file, 5_000);
      const symbols = await client.symbols(file);
      assert.ok(symbols.some((item) => item.name === 'value'), JSON.stringify({ symbols, detail: client.detail }));
      assert.ok(
        diagnostics.some((item) => /number.*string|assignable/i.test(item.message)),
        JSON.stringify({ diagnostics, symbols, detail: client.detail, logTail: client.logTail }),
      );
    } finally {
      await client.stop();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('clears diagnostics and ignores stale publications after a document change', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-lsp-stale-'));
    const file = path.join(root, 'index.ts');
    await fs.writeFile(file, 'const broken: string = 1;\n');
    const spec = serverFor(file);
    assert.ok(spec);
    const client = new LspClient({
      spec,
      command: process.execPath,
      args: [STALE_VERSION_SERVER],
      source: 'test',
    }, root);

    try {
      await client.start();
      const first = await client.diagnose(file, 500);
      assert.equal(first[0]?.code, 'old-content');

      await fs.writeFile(file, 'const valid = 1;\n');
      const [left, right] = await Promise.all([
        client.diagnose(file, 500),
        client.diagnose(file, 500),
      ]);
      assert.deepEqual(left, []);
      assert.deepEqual(right, []);
    } finally {
      await client.stop();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});

class FakeClient {
  readonly id: string;
  readonly label: string;
  readonly root: string;
  ready = false;
  detail = 'not started';
  starts = 0;
  stops = 0;

  constructor(spec: ServerSpec, root: string) {
    this.id = spec.id;
    this.label = spec.label;
    this.root = root;
  }

  async start(): Promise<void> {
    this.starts += 1;
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    this.ready = true;
    this.detail = 'ready';
  }

  async stop(): Promise<void> {
    this.stops += 1;
    this.ready = false;
    this.detail = 'stopped';
  }

  async diagnose(): Promise<[]> { return []; }
  allDiagnostics(): [] { return []; }
}

describe('LspManager lifecycle', () => {
  it('shares warmup with first use and restarts a stopped server', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-lsp-manager-'));
    const file = path.join(root, 'index.ts');
    await fs.writeFile(file, 'export const value = 1;\n');
    await fs.writeFile(path.join(root, 'tsconfig.json'), '{}\n');

    const created: FakeClient[] = [];
    const resolveServer = async (spec: ServerSpec): Promise<ResolvedServer> => ({
      spec,
      command: process.execPath,
      args: [FAKE_SERVER],
      source: 'test',
    });
    const manager = new LspManager({
      root,
      resolveServer,
      createClient: (resolved: ResolvedServer, workspace: string) => {
        const client = new FakeClient(resolved.spec, workspace);
        created.push(client);
        return client as unknown as LspClient;
      },
    });

    try {
      const [, first] = await Promise.all([manager.warmup(), manager.clientFor(file)]);
      assert.ok(first);
      const firstTypeScriptClients = created.filter((client) => client.id === 'typescript');
      assert.equal(firstTypeScriptClients.length, 1);
      assert.equal(firstTypeScriptClients[0]?.starts, 1);

      firstTypeScriptClients[0]!.ready = false;
      const restarted = await manager.clientFor(file);
      assert.ok(restarted);
      const restartedTypeScriptClients = created.filter((client) => client.id === 'typescript');
      assert.equal(restartedTypeScriptClients.length, 2);
      assert.equal(restartedTypeScriptClients[0]?.stops, 1);
      assert.equal(restartedTypeScriptClients[1]?.starts, 1);
    } finally {
      await manager.stop();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
