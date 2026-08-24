import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { containerTempMount } from '../src/container-paths.js';
import { createSessionTempWorkspace, TEMP_WORKDIR } from '../src/temp-workspace.js';

test('session temp workspace creates an isolated host directory mounted at /temp and cleans it up', async () => {
  const workspace = await createSessionTempWorkspace();
  try {
    assert.equal(workspace.virtualPath, TEMP_WORKDIR);
    assert.equal(path.dirname(workspace.hostPath), path.resolve(os.tmpdir()));
    assert.deepEqual(containerTempMount(workspace.hostPath), {
      source: path.resolve(workspace.hostPath),
      target: '/temp',
      mode: 'rw',
      mask: [],
    });

    const scratch = path.join(workspace.hostPath, 'probe.txt');
    await fs.writeFile(scratch, 'session-only');
    assert.equal(await fs.readFile(scratch, 'utf8'), 'session-only');
    await workspace.cleanup();
    await workspace.cleanup();
    await assert.rejects(fs.stat(workspace.hostPath), { code: 'ENOENT' });
  } finally {
    await workspace.cleanup();
  }
});
