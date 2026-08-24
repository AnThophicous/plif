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

  async hostPathFor(path: string): Promise<string> {
    return path;
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

  it('skips generated and dependency directories during broad discovery', async () => {
    const files: Record<string, string> = {
      '/project/src/providers.ts': 'const providers = true;\n',
      '/project/.git/old.ts': 'const providers = false;\n',
      '/project/dist/bundle.ts': 'const providers = false;\n',
      '/project/.gitignore': 'generated/\nignored.ts\n',
      '/project/.ignore': 'scratch/\nignored-too.ts\n',
      '/project/.rgignore': 'rg-only.ts\n',
      '/project/rg-only.ts': 'const providers = false;\n',
    };
    for (const folder of ['node_modules', 'coverage', 'build', 'generated', 'scratch']) {
      files[`/project/${folder}/ignored.ts`] = 'const providers = false;\n';
    }
    // A dependency tree large enough to trip the old global walker must be
    // pruned at its directory boundary, before its children count toward the
    // discovery budget.
    for (let index = 0; index < 10_050; index += 1) {
      files[`/project/node_modules/pkg-${index}/index.ts`] = 'const providers = false;\n';
    }

    const container = new MemoryContainer(files);
    const result = await globFiles.run(
      { path: '/project', pattern: '**/*.ts' },
      context(container),
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.output.split('\n'), ['/project/src/providers.ts']);
  });

  it('honors ignore files while allowing an explicitly requested ignored root', async () => {
    const container = new MemoryContainer({
      '/project/.gitignore': 'ignored.ts\n',
      '/project/.ignore': 'scratch/\n',
      '/project/.rgignore': 'rg-only.ts\n',
      '/project/src/providers.ts': 'providers\n',
      '/project/ignored.ts': 'providers\n',
      '/project/rg-only.ts': 'providers\n',
      '/project/scratch/ignored.ts': 'providers\n',
      '/project/node_modules/explicit.ts': 'providers\n',
    });

    const broad = await grepFiles.run(
      { path: '/project', pattern: 'providers', include: '**/*.ts' },
      context(container),
    );
    assert.equal(broad.output, '/project/src/providers.ts:1:providers');

    const explicit = await globFiles.run(
      { path: '/project/node_modules', pattern: '**/*.ts' },
      context(container),
    );
    assert.equal(explicit.output, '/project/node_modules/explicit.ts');
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

  it('runs diagnostics once per changed file after the transaction', async () => {
    const container = new MemoryContainer({
      '/project/a.ts': 'old a',
      '/project/b.ts': 'old b',
    });
    const calls: string[] = [];
    const snapshots: string[][] = [];
    const contextWithLsp = {
      ...context(container),
      lsp: {
        root: '/project',
        diagnose: async (file: string) => {
          calls.push(file);
          snapshots.push([
            container.files.get('/project/a.ts') ?? '',
            container.files.get('/project/b.ts') ?? '',
          ]);
          return file.endsWith('/a.ts')
            ? [{ file, line: 1, column: 1, severity: 'error' as const, message: 'broken after patch' }]
            : [];
        },
      },
    } as unknown as ToolContext;

    const result = await applyPatch.run(
      {
        edits: [
          { path: '/project/a.ts', old_string: 'old a', new_string: 'new a' },
          { path: '/project/b.ts', old_string: 'old b', new_string: 'new b' },
        ],
      },
      contextWithLsp,
    );

    assert.deepEqual(calls, ['/project/a.ts', '/project/b.ts']);
    assert.deepEqual(snapshots, [['new a', 'new b'], ['new a', 'new b']]);
    assert.equal(result.ok, false);
    assert.match(result.output, /Language server: 1 error\(s\)/);
    assert.match(result.output, /\/project\/a\.ts/);
  });
});
