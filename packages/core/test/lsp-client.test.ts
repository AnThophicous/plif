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
      // Ask for symbols first. documentSymbol is a request with a reply, so it
      // does not return until tsserver has actually loaded the project, whereas
      // diagnose only waits out a timer. Ordering it this way turns a cold start
      // under load from a failed assertion into a slower one, and the settle
      // budget is generous for the same reason: diagnose returns as soon as the
      // diagnostics stop changing, so a large ceiling costs a fast run nothing.
      const symbols = await client.symbols(file);
      const diagnostics = await client.diagnose(file, 20_000);
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

  it('searches the whole project for a declaration, without opening a file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-lsp-wsymbol-'));
    const file = path.join(root, 'index.ts');
    await fs.writeFile(file, 'export const value = 1;\n');
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
      const hits = await client.workspaceSymbols('Widget');

      // Three were offered; the one with no location is not a place, so it goes.
      assert.equal(hits.length, 2);
      assert.equal(hits[0]?.name, 'Widget');
      assert.equal(hits[0]?.kind, 'class');
      assert.equal(hits[0]?.line, 12);
      assert.equal(hits[0]?.container, 'shell');
      assert.match(hits[0]?.file ?? '', /widget.ts$/);
      // No range yet means the file is known and the line is not; line 1 is the
      // honest floor, and losing the hit would be worse than an imprecise line.
      assert.equal(hits[1]?.name, 'WidgetProps');
      assert.equal(hits[1]?.line, 1);
      assert.equal(hits[1]?.container, undefined);

      assert.deepEqual(await client.workspaceSymbols('nothing-like-this'), []);
      assert.equal((await client.workspaceSymbols('Widget', 1)).length, 1);
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
  /** When set, the first workspace query answers nothing, as a cold index does. */
  static coldIndex = false;

  #queries = 0;
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

  openDocumentCount = 0;

  async awaitAnalysis(): Promise<boolean> {
    return true;
  }

  supports(): boolean {
    return true;
  }

  async openFile(): Promise<boolean> {
    this.openDocumentCount += 1;
    return true;
  }

  async workspaceSymbols(): Promise<unknown[]> {
    this.#queries += 1;
    if (FakeClient.coldIndex && this.#queries === 1) return [];
    // The same declaration twice, as two servers indexing one file would report
    // it, plus a second distinct one.
    return [
      { name: 'Widget', kind: 'class', file: path.join(this.root, 'widget.ts'), line: 3 },
      { name: 'Widget', kind: 'class', file: path.join(this.root, 'widget.ts'), line: 3 },
      { name: 'WidgetProps', kind: 'interface', file: path.join(this.root, 'props.ts'), line: 9 },
    ];
  }

  async diagnose(): Promise<[]> { return []; }
  allDiagnostics(): [] { return []; }
}

describe('LspManager lifecycle', () => {
  it('merges symbol hits from every running server and reports each place once', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-lsp-search-'));
    await fs.writeFile(path.join(root, 'index.ts'), 'export const value = 1;\n');
    await fs.writeFile(path.join(root, 'tsconfig.json'), '{}\n');

    const manager = new LspManager({
      root,
      resolveServer: async (spec: ServerSpec): Promise<ResolvedServer> => ({
        spec,
        command: process.execPath,
        args: [FAKE_SERVER],
        source: 'test',
      }),
      createClient: (resolved: ResolvedServer, workspace: string) =>
        new FakeClient(resolved.spec, workspace) as unknown as LspClient,
    });

    try {
      const hits = await manager.searchSymbols('Widget');
      assert.ok(hits);
      assert.deepEqual(
        hits.map((hit) => `${hit.name}:${hit.line}`),
        ['Widget:3', 'WidgetProps:9'],
      );
      assert.equal((await manager.searchSymbols('Widget', 1))?.length, 1);
    } finally {
      await manager.stop();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('waits for a just-opened project to finish indexing before reporting nothing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-lsp-cold-'));
    await fs.writeFile(path.join(root, 'index.ts'), 'export const value = 1;\n');
    await fs.writeFile(path.join(root, 'tsconfig.json'), '{}\n');

    const manager = new LspManager({
      root,
      resolveServer: async (spec: ServerSpec): Promise<ResolvedServer> => ({
        spec,
        command: process.execPath,
        args: [FAKE_SERVER],
        source: 'test',
      }),
      createClient: (resolved: ResolvedServer, workspace: string) =>
        new FakeClient(resolved.spec, workspace) as unknown as LspClient,
    });

    FakeClient.coldIndex = true;
    try {
      // The first query lands before the server has built its index. Reporting
      // that as "no such symbol" is the one answer this search must never give.
      const hits = await manager.searchSymbols('Widget');
      assert.equal(hits?.length, 2);
    } finally {
      FakeClient.coldIndex = false;
      await manager.stop();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('answers null when nothing indexes the workspace, which is not an empty result', async () => {
    const manager = new LspManager({ root: os.tmpdir(), enabled: false });
    assert.equal(await manager.searchSymbols('Widget'), null);
  });

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
