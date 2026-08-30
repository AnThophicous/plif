import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { PlifError } from '../src/errors.js';
import {
  parseDotEnv,
  personalSessionEnvironmentPath,
  serializeDotEnv,
  SessionEnvironmentStore,
  type SessionEnvironmentScope,
} from '../src/auth/session-env.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function scope(workspace: string, sessionId = 'session-a'): SessionEnvironmentScope {
  return { workspace, sessionId };
}

function base64Runner(): (
  mode: 'protect' | 'unprotect',
  input: string,
) => Promise<string> {
  return async (mode, input) => mode === 'protect'
    ? Buffer.from(input, 'utf8').toString('base64')
    : Buffer.from(input, 'base64').toString('utf8');
}

function base64SystemdRunner(): (
  mode: 'protect' | 'unprotect',
  input: string,
  name: string,
) => Promise<string> {
  return async (mode, input, _name) => base64Runner()(mode, input);
}

async function filesUnder(root: string): Promise<string[]> {
  const found: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else found.push(full);
    }
  }
  await visit(root);
  return found;
}

describe('session-scoped environment parsing', () => {
  it('parses dotenv syntax and serializes it deterministically', () => {
    const values = parseDotEnv([
      '# comments are ignored',
      'export API_KEY="token # with spaces"',
      'URL=https://example.test/#fragment',
      "NAME='Plif user'",
      'EMPTY=',
      'URL=https://example.test/final',
    ].join('\n'));

    assert.deepEqual(values, {
      API_KEY: 'token # with spaces',
      URL: 'https://example.test/final',
      NAME: 'Plif user',
      EMPTY: '',
    });

    const serialized = serializeDotEnv({
      ZED: 'line one\nline two',
      API_KEY: 'token # with spaces',
      EMPTY: '',
    });
    assert.equal(serialized, 'API_KEY="token # with spaces"\nEMPTY=""\nZED="line one\\nline two"\n');
    assert.deepEqual(parseDotEnv(serialized), {
      API_KEY: 'token # with spaces',
      EMPTY: '',
      ZED: 'line one\nline two',
    });
  });

  it('never echoes a pasted secret in parser errors', () => {
    const secret = 'do-not-echo-this-token';
    assert.throws(
      () => parseDotEnv(`KEY="${secret}`),
      (error: unknown) => {
        assert.equal(error instanceof PlifError, true);
        assert.equal((error as Error).message.includes(secret), false);
        assert.equal(JSON.stringify(error).includes(secret), false);
        return true;
      },
    );
  });

  it('keeps the default store outside transcripts and project workspaces', () => {
    assert.equal(
      personalSessionEnvironmentPath('C:/Users/Plif'),
      path.join('C:/Users/Plif', '.plif', 'session-env'),
    );
  });
});

describe('encrypted session environments', () => {
  it('binds records to workspace and session, without exposing values in status', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-session-env-'));
    roots.push(root);
    const workspaceA = path.join(root, 'workspace-a');
    const workspaceB = path.join(root, 'workspace-b');
    const secret = 'session-secret-never-on-disk';
    const store = new SessionEnvironmentStore({
      root,
      backend: 'windows-dpapi',
      dpapi: base64Runner(),
    });

    await store.set(scope(workspaceA), { API_TOKEN: secret });
    await store.set(scope(workspaceA, 'session-b'), { OTHER_TOKEN: 'other-session' });
    await store.set(scope(workspaceB), { API_TOKEN: 'other-workspace' });

    assert.deepEqual(await store.loadForExecution(scope(workspaceA)), { API_TOKEN: secret });
    assert.deepEqual(await store.loadForExecution(scope(workspaceA, 'session-b')), {
      OTHER_TOKEN: 'other-session',
    });
    assert.deepEqual(await store.loadForExecution(scope(workspaceB)), { API_TOKEN: 'other-workspace' });

    const status = await store.status(scope(workspaceA));
    assert.deepEqual(status.names, ['API_TOKEN']);
    assert.equal(status.persistent, true);
    assert.equal(status.secureBackendAvailable, true);
    assert.equal(JSON.stringify(status).includes(secret), false);
    assert.equal('values' in status, false);

    const diskFiles = await filesUnder(root);
    assert.equal(diskFiles.length, 3);
    for (const file of diskFiles) {
      const disk = await fs.readFile(file, 'utf8');
      assert.equal(disk.includes(secret), false);
      assert.equal(disk.includes('session-a'), false);
    }

    // A new store can recover the encrypted record, while a different scope
    // cannot even address the same ciphertext.
    const reopened = new SessionEnvironmentStore({
      root,
      backend: 'windows-dpapi',
      dpapi: base64Runner(),
    });
    assert.deepEqual(await reopened.loadForExecution(scope(workspaceA)), { API_TOKEN: secret });
    assert.deepEqual(await reopened.names(scope(workspaceA, 'missing')), []);
  });

  it('supports the Linux systemd-creds boundary through the same safe contract', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-linux-session-env-'));
    roots.push(root);
    const store = new SessionEnvironmentStore({
      root,
      backend: 'linux-systemd-creds',
      systemdCreds: base64SystemdRunner(),
    });

    await store.importDotEnv(scope(path.join(root, 'workspace')), 'FIRST=one\nSECOND="two words"\n');
    assert.deepEqual(await store.loadForExecution(scope(path.join(root, 'workspace'))), {
      FIRST: 'one',
      SECOND: 'two words',
    });
    assert.deepEqual(await store.names(scope(path.join(root, 'workspace'))), ['FIRST', 'SECOND']);
  });

  it('does not import a dotenv file outside the active workspace', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-dotenv-boundary-'));
    roots.push(root);
    const workspace = path.join(root, 'workspace');
    const outside = path.join(root, 'outside.env');
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(outside, 'OUTSIDE_SECRET=must-not-be-read\n', 'utf8');
    const store = new SessionEnvironmentStore({ root, backend: 'memory' });

    await assert.rejects(
      store.importFile(scope(workspace), path.join('..', 'outside.env')),
      (error: unknown) => error instanceof PlifError && error.message.includes('inside the active workspace'),
    );
    assert.deepEqual(await store.names(scope(workspace)), []);
  });

  it('serializes concurrent updates per session and leaves no temporary files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-concurrent-session-env-'));
    roots.push(root);
    const workspace = path.join(root, 'workspace');
    const crypt = async (mode: 'protect' | 'unprotect', input: string): Promise<string> => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return mode === 'protect'
        ? Buffer.from(input, 'utf8').toString('base64')
        : Buffer.from(input, 'base64').toString('utf8');
    };
    const store = new SessionEnvironmentStore({ root, backend: 'windows-dpapi', dpapi: crypt });
    const current = scope(workspace);

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        store.set(current, { [`KEY_${index}`]: `value-${index}` }),
      ),
    );

    const loaded = await store.loadForExecution(current);
    assert.deepEqual(Object.keys(loaded).sort(), Array.from({ length: 8 }, (_, index) => `KEY_${index}`));
    const temporaryFiles = (await filesUnder(root)).filter((file) => file.endsWith('.tmp'));
    assert.deepEqual(temporaryFiles, []);
  });

  it('falls back to process memory without creating a plaintext persistence file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-memory-session-env-'));
    roots.push(root);
    const secret = 'memory-only-secret';
    const store = new SessionEnvironmentStore({
      root,
      backend: 'windows-dpapi',
      dpapi: async () => {
        throw new Error('secure helper unavailable');
      },
    });
    const current = scope(path.join(root, 'workspace'));

    await store.set(current, { MEMORY_SECRET: secret });
    const status = await store.status(current);
    assert.equal(status.backend, 'memory');
    assert.equal(status.persistent, false);
    assert.equal(status.secureBackendAvailable, false);
    assert.equal(status.warning?.includes(secret), false);
    assert.deepEqual(await store.loadForExecution(current), { MEMORY_SECRET: secret });
    assert.equal((await filesUnder(root)).length, 0);
  });

  it('does not overwrite an unopened encrypted record or resurrect stale values', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-stale-session-env-'));
    roots.push(root);
    const current = scope(path.join(root, 'workspace'));
    const original = new SessionEnvironmentStore({
      root,
      backend: 'windows-dpapi',
      dpapi: base64Runner(),
    });
    await original.set(current, { OLD_SECRET: 'must-survive-unopened' });

    const unavailable = new SessionEnvironmentStore({
      root,
      backend: 'windows-dpapi',
      dpapi: async (mode) => {
        if (mode === 'unprotect') throw new Error('secure helper unavailable');
        return 'not-written';
      },
    });

    const status = await unavailable.status(current);
    assert.equal(status.backend, 'memory');
    assert.equal(status.names.length, 0);
    assert.equal(status.warning?.includes('could not be opened'), true);
    await assert.rejects(
      unavailable.set(current, { NEW_SECRET: 'must-not-hide-old-record' }),
      (error: unknown) => error instanceof PlifError && error.code === 'INTERNAL',
    );

    const stillRecoverable = new SessionEnvironmentStore({
      root,
      backend: 'windows-dpapi',
      dpapi: base64Runner(),
    });
    assert.deepEqual(await stillRecoverable.loadForExecution(current), {
      OLD_SECRET: 'must-survive-unopened',
    });

    await unavailable.clear(current);
    assert.deepEqual(await stillRecoverable.loadForExecution(current), {});
  });

  it('removes names without needing or returning their values', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-remove-session-env-'));
    roots.push(root);
    const current = scope(path.join(root, 'workspace'));
    const store = new SessionEnvironmentStore({ root, backend: 'memory' });
    await store.set(current, { KEEP: 'one', REMOVE: 'two' });

    const status = await store.remove(current, { REMOVE: 'a-value-the-ui-never-reads' });
    assert.deepEqual(status.names, ['KEEP']);
    assert.deepEqual(await store.loadForExecution(current), { KEEP: 'one' });
    assert.equal(JSON.stringify(status).includes('two'), false);

    const cleared = await store.clear(current);
    assert.deepEqual(cleared.names, []);
    assert.deepEqual(await store.loadForExecution(current), {});
  });
});
