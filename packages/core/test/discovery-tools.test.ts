import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyPatch, globFiles, grepFiles } from '../src/harness/tools.js';
import type { ToolContext } from '../src/harness/tools.js';

class MemoryContainer {
  readonly files = new Map<string, string>();
  failWrite: string | null = null;

  constructor(files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) this.files.set(path, content);
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`missing ${path}`);
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (this.failWrite === path) {
      this.failWrite = null;
      throw new Error(`failed ${path}`);
    }
    this.files.set(path, content);
  }

  async listDir(root: string): Promise<{ name: string; kind: 'file' | 'directory' }[]> {
    const prefix = root === '/' ? '/' : `${root}/`;
    const entries = new Map<string, 'file' | 'directory'>();
    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (!rest) continue;
      const slash = rest.indexOf('/');
      entries.set(slash < 0 ? rest : rest.slice(0, slash), slash < 0 ? 'file' : 'directory');
    }
    return [...entries].map(([name, kind]) => ({ name, kind }));
  }
}

function context(container: MemoryContainer): ToolContext {
  return { container } as unknown as ToolContext;
}

describe('structured discovery tools', () => {
  it('finds recursive files with double-star patterns', async () => {
    const container = new MemoryContainer({
      '/project/index.ts': '',
      '/project/src/app.ts': '',
      '/project/src/app.test.ts': '',
      '/project/readme.md': '',
    });

    const result = await globFiles.run(
      { path: '/project', pattern: '**/*.ts' },
      context(container),
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.output.split('\n'), [
      '/project/index.ts',
      '/project/src/app.test.ts',
      '/project/src/app.ts',
    ]);
  });

  it('returns grep matches with file and line while honoring include', async () => {
    const container = new MemoryContainer({
      '/project/src/app.ts': 'const value = 1;\nTODO: improve\n',
      '/project/src/app.js': 'TODO: ignore\n',
    });

    const result = await grepFiles.run(
      { path: '/project', pattern: 'todo', include: '**/*.ts', case_sensitive: false },
      context(container),
    );

    assert.equal(result.output, '/project/src/app.ts:2:TODO: improve');
  });
});

describe('transactional apply_patch tool', () => {
  it('validates every edit before writing any file', async () => {
    const container = new MemoryContainer({
      '/project/a.ts': 'old a',
      '/project/b.ts': 'old b',
    });

    await assert.rejects(
      applyPatch.run(
        {
          edits: [
            { path: '/project/a.ts', old_string: 'old a', new_string: 'new a' },
            { path: '/project/b.ts', old_string: 'missing', new_string: 'new b' },
          ],
        },
        context(container),
      ),
    );

    assert.equal(container.files.get('/project/a.ts'), 'old a');
    assert.equal(container.files.get('/project/b.ts'), 'old b');
  });

  it('restores earlier files when a later write fails', async () => {
    const container = new MemoryContainer({
      '/project/a.ts': 'old a',
      '/project/b.ts': 'old b',
    });
    container.failWrite = '/project/b.ts';

    await assert.rejects(
      applyPatch.run(
        {
          edits: [
            { path: '/project/a.ts', old_string: 'old a', new_string: 'new a' },
            { path: '/project/b.ts', old_string: 'old b', new_string: 'new b' },
          ],
        },
        context(container),
      ),
    );

    assert.equal(container.files.get('/project/a.ts'), 'old a');
    assert.equal(container.files.get('/project/b.ts'), 'old b');
  });
});
