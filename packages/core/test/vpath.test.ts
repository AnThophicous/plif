/**
 * Path jail tests.
 *
 * These are the highest-value tests in the repository. Every filesystem access
 * a container makes funnels through `normalizeVirtualPath` and `PathJail`, so a
 * regression here is a sandbox escape, not a bug. The cases are drawn from the
 * families of path-traversal that actually appear in advisories rather than
 * from what looked plausible while writing the code.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { PathJail, isPathInside, normalizeVirtualPath } from '../src/fs/vpath.js';
import { PlifError } from '../src/errors.js';

const isWindows = process.platform === 'win32';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return PlifError.is(error) ? error.code : `NOT_PLIF:${String(error)}`;
  }
  return 'NO_THROW';
}

describe('normalizeVirtualPath', () => {
  it('canonicalises separators, dot segments and trailing slashes', () => {
    assert.equal(normalizeVirtualPath('/workspace/./src//index.ts'), '/workspace/src/index.ts');
    assert.equal(normalizeVirtualPath('\\workspace\\src'), '/workspace/src');
    assert.equal(normalizeVirtualPath('/workspace/'), '/workspace');
    assert.equal(normalizeVirtualPath('/'), '/');
  });

  it('resolves interior .. without letting it reach past the root', () => {
    assert.equal(normalizeVirtualPath('/workspace/src/../lib/a.ts'), '/workspace/lib/a.ts');
    assert.equal(codeOf(() => normalizeVirtualPath('/../etc/passwd')), 'PATH_ESCAPE');
    assert.equal(codeOf(() => normalizeVirtualPath('/workspace/../../etc')), 'PATH_ESCAPE');
  });

  it('rejects a NUL byte, which would truncate the path in any C API below us', () => {
    assert.equal(codeOf(() => normalizeVirtualPath('/workspace/a\0.txt')), 'PATH_ESCAPE');
  });

  it('requires absolute paths rather than guessing a base', () => {
    assert.equal(codeOf(() => normalizeVirtualPath('workspace/a.ts')), 'INVALID_ARGUMENT');
    assert.equal(codeOf(() => normalizeVirtualPath('')), 'INVALID_ARGUMENT');
  });

  it('does not clamp an escape to the root', () => {
    // Clamping "/../etc" to "/etc" would silently convert an attack into a
    // confusing read of the wrong file. It must be an error.
    assert.notEqual(codeOf(() => normalizeVirtualPath('/../etc')), 'NO_THROW');
  });
});

describe('normalizeVirtualPath on Windows', { skip: !isWindows }, () => {
  it('rejects reserved device names in any directory and with any extension', () => {
    for (const name of ['CON', 'nul', 'COM1.txt', 'lpt9', 'AUX']) {
      assert.equal(
        codeOf(() => normalizeVirtualPath(`/workspace/${name}`)),
        'PATH_ESCAPE',
        `expected ${name} to be rejected`,
      );
    }
  });

  it('rejects alternate data streams', () => {
    assert.equal(codeOf(() => normalizeVirtualPath('/workspace/notes.txt:hidden')), 'PATH_ESCAPE');
  });

  it('rejects 8.3 short names that could alias a long name past a prefix check', () => {
    assert.equal(codeOf(() => normalizeVirtualPath('/workspace/PROGRA~1/x')), 'PATH_ESCAPE');
  });

  it('rejects trailing dots and spaces, which Win32 silently strips', () => {
    // "secret.txt." and "secret.txt" are the same file to the OS but different
    // strings to a policy matcher — that gap is the whole attack.
    assert.equal(codeOf(() => normalizeVirtualPath('/workspace/secret.txt.')), 'PATH_ESCAPE');
    assert.equal(codeOf(() => normalizeVirtualPath('/workspace/secret.txt ')), 'PATH_ESCAPE');
  });

  it('accepts ordinary names that merely contain a reserved word', () => {
    assert.equal(normalizeVirtualPath('/workspace/console.ts'), '/workspace/console.ts');
    assert.equal(normalizeVirtualPath('/workspace/auxiliary'), '/workspace/auxiliary');
  });
});

describe('isPathInside', () => {
  it('compares by component, not by string prefix', () => {
    const parent = path.resolve('/tmp/work');
    assert.equal(isPathInside(path.resolve('/tmp/work/src'), parent), true);
    assert.equal(isPathInside(parent, parent), true);
    // The bug this guards: "work-secrets" starts with "work".
    assert.equal(isPathInside(path.resolve('/tmp/work-secrets'), parent), false);
    assert.equal(isPathInside(path.resolve('/tmp'), parent), false);
  });
});

describe('PathJail', () => {
  let root: string;
  let upper: string;
  let outside: string;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-jail-'));
    upper = path.join(root, 'upper');
    outside = path.join(root, 'outside');
    await fs.mkdir(path.join(upper, 'workspace'), { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, 'secret.txt'), 'do not read me', 'utf8');
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function jail(mounts: ConstructorParameters<typeof PathJail>[0]['mounts'] = []) {
    return new PathJail({ upperDir: upper, lowerDirs: [], mounts });
  }

  it('maps a virtual path into the writable layer', async () => {
    const resolved = await jail().resolveWrite('/workspace/a.ts');
    assert.equal(resolved.virtual, '/workspace/a.ts');
    assert.equal(isPathInside(resolved.host, upper), true);
    assert.equal(resolved.writable, true);
  });

  it('refuses to write through a read-only mount', async () => {
    const j = jail([{ source: outside, target: '/vendor', mode: 'ro' }]);
    await assert.rejects(
      () => j.resolveWrite('/vendor/x.ts'),
      (error: unknown) => PlifError.is(error) && error.code === 'MOUNT_READONLY',
    );
  });

  it('allows reads through a read-only mount', async () => {
    const j = jail([{ source: outside, target: '/vendor', mode: 'ro' }]);
    const resolved = await j.resolveRead('/vendor/secret.txt');
    assert.equal(resolved.writable, false);
    assert.equal(resolved.mount?.target, '/vendor');
  });

  it('reports a masked path as absent rather than as forbidden', async () => {
    // Answering "forbidden" would confirm the file exists, which is itself a
    // leak when the mask is hiding a credential file.
    const j = jail([{ source: outside, target: '/vendor', mode: 'ro', mask: ['/secret.txt'] }]);
    await assert.rejects(
      () => j.resolveRead('/vendor/secret.txt'),
      (error: unknown) => PlifError.is(error) && error.code === 'PATH_NOT_FOUND',
    );
  });

  it('prefers the longest matching mount target', async () => {
    const inner = path.join(root, 'inner');
    await fs.mkdir(inner, { recursive: true });
    const j = jail([
      { source: outside, target: '/workspace', mode: 'ro' },
      { source: inner, target: '/workspace/vendor', mode: 'rw' },
    ]);
    const resolved = await j.resolveWrite('/workspace/vendor/x.ts');
    assert.equal(resolved.mount?.target, '/workspace/vendor');
    assert.equal(isPathInside(resolved.host, inner), true);
  });

  it('rejects two mounts claiming the same target', () => {
    assert.throws(
      () =>
        jail([
          { source: outside, target: '/vendor', mode: 'ro' },
          { source: upper, target: '/vendor', mode: 'rw' },
        ]),
      (error: unknown) => PlifError.is(error) && error.code === 'MOUNT_CONFLICT',
    );
  });

  it('blocks a symlink inside the jail that points out of it', async () => {
    // The path string is entirely innocent; only resolution reveals the escape.
    const linkPath = path.join(upper, 'workspace', 'escape');
    try {
      await fs.symlink(outside, linkPath, 'junction');
    } catch {
      return; // Symlink creation needs privilege on Windows; skip if unavailable.
    }

    await assert.rejects(
      () => jail().resolveRead('/workspace/escape/secret.txt'),
      (error: unknown) => PlifError.is(error) && error.code === 'PATH_ESCAPE',
    );
    await fs.rm(linkPath, { force: true, recursive: true });
  });

  it('lists every host directory a sandbox jail may write to', () => {
    const j = jail([
      { source: outside, target: '/ro', mode: 'ro' },
      { source: path.join(root, 'rw'), target: '/rw', mode: 'rw' },
    ]);
    const writable = j.writableHostPaths();
    assert.equal(writable.includes(path.resolve(upper)), true);
    assert.equal(writable.includes(path.resolve(path.join(root, 'rw'))), true);
    assert.equal(writable.includes(path.resolve(outside)), false);
  });
});
