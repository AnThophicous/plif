import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** A host-side control-plane worktree. It is created only by the runtime, never
 * by a model tool; the child still receives ordinary container capabilities. */
export interface WorktreeLease { readonly id: string; readonly repository: string; readonly path: string; readonly ref: string; }

function git(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = ''; let error = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { error += String(chunk); });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(error.trim() || `git exited ${code}`)));
  });
}

export class WorktreeManager {
  readonly root: string;
  constructor(root = path.join(os.tmpdir(), 'plif-worktrees')) { this.root = root; }

  async create(repository: string, label: string, ref = 'HEAD'): Promise<WorktreeLease> {
    const repo = path.resolve(repository);
    await git(repo, ['rev-parse', '--is-inside-work-tree']);
    const id = `${label.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'subagent'}-${randomUUID().slice(0, 8)}`;
    await fs.mkdir(this.root, { recursive: true });
    const target = path.join(this.root, id);
    await git(repo, ['worktree', 'add', '--detach', target, ref]);
    return { id, repository: repo, path: target, ref };
  }

  async release(lease: WorktreeLease): Promise<void> {
    const target = path.resolve(lease.path);
    if (!target.startsWith(path.resolve(this.root) + path.sep)) throw new Error('refusing to remove worktree outside manager root');
    await git(lease.repository, ['worktree', 'remove', '--force', target]);
    await git(lease.repository, ['worktree', 'prune']);
  }
}
