import crypto from 'node:crypto';
import type { Container } from '../container/container.js';

export interface EditConflict {
  readonly id: string;
  readonly path: string;
  readonly contenders: readonly { agentId: string; content: string; baseHash: string }[];
  readonly currentHash: string;
}

type Proposal = { agentId: string; content: string; baseHash: string };

export class EditCoordinator {
  #observed = new Map<string, Map<string, string>>();
  #conflicts = new Map<string, EditConflict>();

  async observe(agentId: string, path: string, content: string): Promise<void> {
    let files = this.#observed.get(agentId);
    if (!files) { files = new Map(); this.#observed.set(agentId, files); }
    files.set(path, hash(content));
  }

  async commit(agentId: string, path: string, content: string, container: Container): Promise<void> {
    const current = await container.readFile(path).catch(() => '');
    const currentHash = hash(current);
    const baseHash = this.#observed.get(agentId)?.get(path) ?? currentHash;
    if (baseHash !== currentHash) {
      const existing = [...this.#conflicts.values()].find((item) => item.path === path && item.currentHash === currentHash);
      if (existing) {
        this.#conflicts.set(existing.id, { ...existing, contenders: [...existing.contenders, { agentId, content, baseHash }] });
        throw new Error(`EDIT_CONFLICT ${existing.id}: ${path} has competing edits; the principal must arbitrate`);
      }
      const id = crypto.randomUUID().slice(0, 8);
      const conflict: EditConflict = {
        id, path, currentHash,
        contenders: [{ agentId, content, baseHash }],
      };
      this.#conflicts.set(id, conflict);
      throw new Error(`EDIT_CONFLICT ${id}: ${path} changed since ${agentId} read it; the principal must arbitrate`);
    }
    await container.writeFile(path, content);
    await this.observe(agentId, path, content);
  }

  list(): EditConflict[] { return [...this.#conflicts.values()]; }

  async resolve(id: string, content: string, container: Container): Promise<void> {
    const conflict = this.#conflicts.get(id);
    if (!conflict) throw new Error(`unknown edit conflict ${id}`);
    await container.writeFile(conflict.path, content);
    this.#conflicts.delete(id);
  }
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}
