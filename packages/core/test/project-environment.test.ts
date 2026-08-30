import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  ProjectEnvironmentStore,
  type ProjectSecretBackend,
} from '../src/index.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

class FakeNativeBackend implements ProjectSecretBackend {
  readonly kind = 'windows-credential-manager' as const;
  readonly values = new Map<string, string>();
  available: boolean;

  constructor(available = true) {
    this.available = available;
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async load(target: string): Promise<string | undefined> {
    return this.values.get(target);
  }

  async save(target: string, value: string): Promise<void> {
    this.values.set(target, value);
  }

  async clear(target: string): Promise<void> {
    this.values.delete(target);
  }
}

describe('project environment store', () => {
  it('shares a project vault across sessions while keeping projects isolated', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-project-env-native-'));
    roots.push(root);
    const backend = new FakeNativeBackend();
    const first = new ProjectEnvironmentStore({
      root,
      backend: 'windows-credential-manager',
      native: backend,
    });
    const alpha = path.join(root, 'alpha');
    const beta = path.join(root, 'beta');

    await first.set({ workspace: alpha }, { API_KEY: 'native-secret' });
    assert.deepEqual((await first.status({ workspace: alpha })).names, ['API_KEY']);
    assert.equal(JSON.stringify(await first.status({ workspace: alpha })).includes('native-secret'), false);
    assert.deepEqual(await first.loadForExecution({ workspace: beta }), {});

    const reopened = new ProjectEnvironmentStore({
      root,
      backend: 'windows-credential-manager',
      native: backend,
    });
    assert.deepEqual(await reopened.loadForExecution({ workspace: alpha }), { API_KEY: 'native-secret' });
    assert.deepEqual(await reopened.names({ workspace: beta }), []);
  });

  it('falls back to an encrypted passphrase vault and can be locked again', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-project-env-fallback-'));
    roots.push(root);
    const workspace = path.join(root, 'workspace');
    const passphrase = 'correct horse battery staple';
    const store = new ProjectEnvironmentStore({
      root,
      backend: 'encrypted-fallback',
      passphrase,
    });

    await store.set({ workspace }, { DATABASE_URL: 'fallback-secret' });
    const status = await store.status({ workspace });
    assert.equal(status.backend, 'encrypted-fallback');
    assert.equal(status.persistent, true);
    assert.equal(status.secureBackendAvailable, false);
    assert.equal(status.warning?.includes('fallback-secret'), false);

    const files = await fs.readdir(root);
    assert.equal(files.some((file) => file.endsWith('.vault')), true);
    const vault = await fs.readFile(path.join(root, files.find((file) => file.endsWith('.vault'))!), 'utf8');
    assert.equal(vault.includes('fallback-secret'), false);

    store.lock();
    assert.deepEqual(await store.loadForExecution({ workspace }), { DATABASE_URL: 'fallback-secret' });

    const wrong = new ProjectEnvironmentStore({
      root,
      backend: 'encrypted-fallback',
      passphrase: 'a different sufficiently long passphrase',
    });
    await assert.rejects(wrong.loadForExecution({ workspace }), /passphrase is incorrect or the vault is damaged/);
  });

  it('uses encrypted fallback when the native store is unavailable', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-project-env-degraded-'));
    roots.push(root);
    const backend = new FakeNativeBackend(false);
    const store = new ProjectEnvironmentStore({
      root,
      backend: 'windows-credential-manager',
      native: backend,
      passphrase: 'another sufficiently long passphrase',
    });

    await store.set({ workspace: path.join(root, 'workspace') }, { TOKEN: 'degraded-secret' });
    const status = await store.status({ workspace: path.join(root, 'workspace') });
    assert.equal(status.backend, 'encrypted-fallback');
    assert.match(status.warning ?? '', /native credential store is unavailable/);
  });
});
