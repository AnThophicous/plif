import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';
import { WorktreeManager } from '../src/harness/worktrees.js';

const exec = promisify(execFile);

describe('WorktreeManager', () => {
  it('creates an isolated detached checkout and removes only its own lease', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-worktree-test-'));
    const repo = path.join(root, 'repo'); const managed = path.join(root, 'managed');
    await fs.mkdir(repo); await exec('git', ['init'], { cwd: repo });
    await exec('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo });
    await exec('git', ['config', 'user.name', 'test'], { cwd: repo });
    await fs.writeFile(path.join(repo, 'a.txt'), 'base\n');
    await exec('git', ['add', '.'], { cwd: repo }); await exec('git', ['commit', '-m', 'base'], { cwd: repo });
    const manager = new WorktreeManager(managed); const lease = await manager.create(repo, 'review');
    try { assert.equal((await fs.readFile(path.join(lease.path, 'a.txt'), 'utf8')).replace(/\r\n/g, '\n'), 'base\n'); }
    finally { await manager.release(lease); await fs.rm(root, { recursive: true, force: true }); }
    await assert.rejects(fs.access(lease.path));
  });
});
