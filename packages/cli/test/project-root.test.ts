import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ensureProjectRoot, resolveWorkspace } from '../src/project-root.js';

test('explicit workspace always wins over the saved project root', async () => {
  const selected = await resolveWorkspace('C:/workspace/current', 'C:/workspace/saved', true);
  assert.equal(selected, path.resolve('C:/workspace/current'));
});

test('existing project directory wins over the saved default', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-project-root-test-'));
  try {
    await fs.writeFile(path.join(root, 'package.json'), '{}', 'utf8');
    const selected = await resolveWorkspace(root, path.join(root, 'elsewhere'));
    assert.equal(selected, path.resolve(root));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('the first-run choice is created and returned as a real directory', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-project-choice-test-'));
  const target = path.join(parent, 'projects');
  try {
    assert.equal(await ensureProjectRoot(target), await fs.realpath(target));
    assert.equal((await fs.stat(target)).isDirectory(), true);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});
