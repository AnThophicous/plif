import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import type { WorkspaceChange } from '../src/lsp/client.js';
import type { LspManager } from '../src/lsp/manager.js';
import { renameTool } from '../src/lsp/tools.js';
import type { ToolContext } from '../src/harness/tools.js';

const HOST_ROOT = path.resolve(path.sep + 'workspace-host');

function hostFile(...parts: string[]): string {
  return path.join(HOST_ROOT, ...parts);
}

/**
 * A container that maps /project onto one host directory.
 *
 * The mapping is the thing under test as much as the edits are: the language
 * server answers in host paths, and every write has to come back through a
 * container path or it has escaped the jail the tool is supposed to write inside.
 */
function contextWith(files: Map<string, string>): ToolContext {
  return {
    container: {
      async hostPathFor(virtualPath: string): Promise<string> {
        return path.join(HOST_ROOT, ...virtualPath.split('/').filter(Boolean).slice(1));
      },
      async readFile(virtualPath: string): Promise<string> {
        const text = files.get(virtualPath);
        if (text === undefined) throw new Error(`no such file: ${virtualPath}`);
        return text;
      },
      async writeFile(virtualPath: string, content: string): Promise<void> {
        files.set(virtualPath, content);
      },
    },
  } as unknown as ToolContext;
}

function managerWith(
  change: WorkspaceChange | null,
  options: { canRename?: boolean; references?: string[] } = {},
): LspManager {
  return {
    root: HOST_ROOT,
    async ensureIndexed() {
      return {
        supports: () => options.canRename !== false,
        async references() {
          // A stub that reported no references would make every case wait out the
          // settle loop, so the default is the plan the server itself returned.
          const files =
            options.references ??
            change?.documents.map((document) => document.file) ?? [hostFile('src', 'a.ts')];
          return files.map((file) => ({ file, line: 1, column: 1 }));
        },
        async rename(): Promise<WorkspaceChange | null> {
          return change;
        },
      };
    },
  } as unknown as LspManager;
}

function sourceFiles(): Map<string, string> {
  return new Map([
    ['/project/src/a.ts', 'export const oldName = 1;\n'],
    ['/project/src/b.ts', 'import { oldName } from "./a";\nconsole.log(oldName);\n'],
  ]);
}

const ACROSS_TWO_FILES: WorkspaceChange = {
  fileOperations: 0,
  documents: [
    {
      file: hostFile('src', 'a.ts'),
      edits: [{ startLine: 1, startColumn: 14, endLine: 1, endColumn: 21, newText: 'newName' }],
    },
    {
      file: hostFile('src', 'b.ts'),
      edits: [
        { startLine: 1, startColumn: 10, endLine: 1, endColumn: 17, newText: 'newName' },
        { startLine: 2, startColumn: 13, endLine: 2, endColumn: 20, newText: 'newName' },
      ],
    },
  ],
};

describe('rename_symbol', () => {
  it('rewrites every call site the server named, in container paths', async () => {
    const files = sourceFiles();
    const result = await renameTool(managerWith(ACROSS_TWO_FILES)).run(
      { path: '/project/src/a.ts', line: 1, column: 14, new_name: 'newName' },
      contextWith(files),
    );

    assert.equal(result.ok, true);
    assert.match(result.output, /3 occurrence\(s\) across 2 file\(s\)/);
    assert.equal(files.get('/project/src/a.ts'), 'export const newName = 1;\n');
    assert.equal(
      files.get('/project/src/b.ts'),
      'import { newName } from "./a";\nconsole.log(newName);\n',
    );
  });

  it('writes nothing when one of the files lies outside the workspace', async () => {
    const files = sourceFiles();
    const before = new Map(files);
    const escaping: WorkspaceChange = {
      fileOperations: 0,
      documents: [
        ACROSS_TWO_FILES.documents[0]!,
        {
          file: path.resolve(path.sep + 'elsewhere', 'other.ts'),
          edits: [{ startLine: 1, startColumn: 1, endLine: 1, endColumn: 2, newText: 'x' }],
        },
      ],
    };

    const result = await renameTool(managerWith(escaping)).run(
      { path: '/project/src/a.ts', line: 1, column: 14, new_name: 'newName' },
      contextWith(files),
    );

    assert.equal(result.ok, false);
    assert.match(result.output, /outside this workspace/);
    // The file it could have written is the first one, so an implementation that
    // wrote as it planned would already have changed it by the time it refused.
    assert.deepEqual([...files], [...before]);
  });

  it('refuses a rename that also needs files created, renamed or deleted', async () => {
    const files = sourceFiles();
    const before = new Map(files);
    const result = await renameTool(
      managerWith({ ...ACROSS_TWO_FILES, fileOperations: 1 }),
    ).run(
      { path: '/project/src/a.ts', line: 1, column: 14, new_name: 'newName' },
      contextWith(files),
    );

    assert.equal(result.ok, false);
    assert.match(result.output, /file creation, rename or/);
    assert.deepEqual([...files], [...before]);
  });

  it('refuses edits that do not fit the file rather than writing part of them', async () => {
    const files = sourceFiles();
    const before = new Map(files);
    const impossible: WorkspaceChange = {
      fileOperations: 0,
      documents: [
        {
          file: hostFile('src', 'a.ts'),
          edits: [{ startLine: 99, startColumn: 1, endLine: 99, endColumn: 2, newText: 'x' }],
        },
      ],
    };

    const result = await renameTool(managerWith(impossible)).run(
      { path: '/project/src/a.ts', line: 1, column: 14, new_name: 'newName' },
      contextWith(files),
    );

    assert.equal(result.ok, false);
    assert.match(result.output, /do not fit/);
    assert.deepEqual([...files], [...before]);
  });

  it('refuses overlapping edits, which would corrupt the file silently', async () => {
    const files = sourceFiles();
    const before = new Map(files);
    const overlapping: WorkspaceChange = {
      fileOperations: 0,
      documents: [
        {
          file: hostFile('src', 'a.ts'),
          edits: [
            { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10, newText: 'a' },
            { startLine: 1, startColumn: 5, endLine: 1, endColumn: 15, newText: 'b' },
          ],
        },
      ],
    };

    const result = await renameTool(managerWith(overlapping)).run(
      { path: '/project/src/a.ts', line: 1, column: 14, new_name: 'newName' },
      contextWith(files),
    );

    assert.equal(result.ok, false);
    assert.match(result.output, /do not fit/);
    assert.deepEqual([...files], [...before]);
  });

  it('refuses when the plan misses a file the server says uses the symbol', async () => {
    const files = sourceFiles();
    const before = new Map(files);
    const result = await renameTool(
      managerWith(ACROSS_TWO_FILES, { references: [hostFile('src', 'c.ts')] }),
    ).run(
      { path: '/project/src/a.ts', line: 1, column: 14, new_name: 'newName' },
      contextWith(files),
    );

    assert.equal(result.ok, false);
    assert.match(result.output, /will not update 1 file\(s\)/);
    assert.deepEqual([...files], [...before]);
  });

  it('applies the reachable part only when told to, and names what it left', async () => {
    const files = sourceFiles();
    const result = await renameTool(
      managerWith(ACROSS_TWO_FILES, { references: [hostFile('src', 'c.ts')] }),
    ).run(
      {
        path: '/project/src/a.ts',
        line: 1,
        column: 14,
        new_name: 'newName',
        allow_partial: true,
      },
      contextWith(files),
    );

    // Not ok: the tree it just wrote does not compile, and saying otherwise would
    // be the same lie the gate exists to prevent.
    assert.equal(result.ok, false);
    assert.match(result.output, /Renamed to newName/);
    assert.match(result.output, /\/project\/src\/c\.ts/);
    assert.match(result.output, /now broken/);
    assert.equal(files.get('/project/src/a.ts'), 'export const newName = 1;\n');
  });

  it('says so plainly when the server declines the position', async () => {
    const files = sourceFiles();
    const result = await renameTool(managerWith(null)).run(
      { path: '/project/src/a.ts', line: 1, column: 1, new_name: 'newName' },
      contextWith(files),
    );

    assert.equal(result.ok, false);
    assert.match(result.output, /would not rename that position/);
  });

  it('does not pretend to rename when the server has no rename support', async () => {
    const files = sourceFiles();
    const before = new Map(files);
    const result = await renameTool(managerWith(ACROSS_TWO_FILES, { canRename: false })).run(
      { path: '/project/src/a.ts', line: 1, column: 14, new_name: 'newName' },
      contextWith(files),
    );

    assert.equal(result.ok, false);
    assert.match(result.output, /does not implement renaming/);
    assert.deepEqual([...files], [...before]);
  });

  it('requires a new name, since an empty one would delete every occurrence', async () => {
    const files = sourceFiles();
    const result = await renameTool(managerWith(ACROSS_TWO_FILES)).run(
      { path: '/project/src/a.ts', line: 1, column: 14, new_name: '   ' },
      contextWith(files),
    );

    assert.equal(result.ok, false);
    assert.match(result.output, /new_name must be/);
  });
});
