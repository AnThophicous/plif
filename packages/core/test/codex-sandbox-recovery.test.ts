import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import os from 'node:os';
import path from 'node:path';

import { repairCorruptCodexWindowsSandboxState } from '../src/model/codex-sandbox-recovery.js';

describe('Codex Windows sandbox state recovery', () => {
  it('quarantines a NUL-filled state file and preserves its bytes', async () => {
    const codexHome = await mkdtemp(path.join(os.tmpdir(), 'plif-codex-sandbox-recovery-'));
    const stateDirectory = path.join(codexHome, '.sandbox');
    const statePath = path.join(stateDirectory, 'deny_read_acl_state.json');
    const corruptState = Buffer.alloc(22);
    try {
      await mkdir(stateDirectory, { recursive: true });
      await writeFile(statePath, corruptState);

      const result = repairCorruptCodexWindowsSandboxState(codexHome, 'win32');

      assert.equal(result.repaired, true);
      assert.equal(result.statePath, statePath);
      assert.ok(result.backupPath);
      assert.deepEqual(await readFile(result.backupPath!), corruptState);
      await assert.rejects(readFile(statePath), { code: 'ENOENT' });
    } finally {
      await rm(codexHome, { recursive: true, force: true });
    }
  });

  it('does not touch a valid JSON state file', async () => {
    const codexHome = await mkdtemp(path.join(os.tmpdir(), 'plif-codex-sandbox-valid-'));
    const stateDirectory = path.join(codexHome, '.sandbox');
    const statePath = path.join(stateDirectory, 'deny_read_acl_state.json');
    const validState = '{"principals":{}}\n';
    try {
      await mkdir(stateDirectory, { recursive: true });
      await writeFile(statePath, validState, 'utf8');

      const result = repairCorruptCodexWindowsSandboxState(codexHome, 'win32');

      assert.equal(result.repaired, false);
      assert.equal(await readFile(statePath, 'utf8'), validState);
      assert.deepEqual(await readdir(stateDirectory), ['deny_read_acl_state.json']);
    } finally {
      await rm(codexHome, { recursive: true, force: true });
    }
  });
});
