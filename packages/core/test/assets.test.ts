import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, describe, it } from 'node:test';

import { BUNDLED_ASSET_DIRECTORY, moduleDirectory, resolveAsset } from '../src/assets.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'plif-assets-test-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

/** A stand-in for a module file living in `directory`. */
function moduleUrlIn(directory: string): string {
  fs.mkdirSync(directory, { recursive: true });
  return pathToFileURL(path.join(directory, 'module.js')).href;
}

function writeFile(file: string, contents = 'x'): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

describe('asset resolution', () => {
  it('reports the directory a module lives in', () => {
    const directory = path.join(scratch, 'where');
    assert.equal(moduleDirectory(moduleUrlIn(directory)), directory);
  });

  it('prefers a bundled copy over the caller candidates', () => {
    const directory = path.join(scratch, 'bundled');
    const moduleUrl = moduleUrlIn(directory);
    const bundled = writeFile(
      path.join(directory, BUNDLED_ASSET_DIRECTORY, 'schema/config.toml'),
    );
    const fallback = writeFile(path.join(directory, 'elsewhere/config.toml'));

    assert.equal(resolveAsset(moduleUrl, 'schema/config.toml', [fallback]), bundled);
  });

  it('falls back to the caller candidates in order when nothing is bundled', () => {
    const directory = path.join(scratch, 'unbundled');
    const moduleUrl = moduleUrlIn(directory);
    const absent = path.join(directory, 'absent/config.toml');
    const present = writeFile(path.join(directory, 'src/config.toml'));

    assert.equal(resolveAsset(moduleUrl, 'schema/config.toml', [absent, present]), present);
  });

  it('resolves a directory asset, not only a file', () => {
    const directory = path.join(scratch, 'directories');
    const moduleUrl = moduleUrlIn(directory);
    const instructions = path.join(directory, BUNDLED_ASSET_DIRECTORY, 'instructions');
    writeFile(path.join(instructions, '00-kernel.md'));

    assert.equal(resolveAsset(moduleUrl, 'instructions', []), instructions);
  });

  it('returns null rather than guessing when the asset is nowhere', () => {
    const directory = path.join(scratch, 'missing');
    const moduleUrl = moduleUrlIn(directory);
    assert.equal(
      resolveAsset(moduleUrl, 'schema/config.toml', [path.join(directory, 'nope.toml')]),
      null,
    );
  });
});

describe('the shipped assets', () => {
  it('are reachable from an unbundled build, which is how the tests run', () => {
    // These are the two the engine cannot start without: a missing instruction
    // directory throws during prompt compilation, and missing builtin skills
    // silently empty the catalogue.
    const instructions = path.resolve('packages/core/src/agenting/instructions');
    const skills = path.resolve('packages/core/src/agenting/skills/builtin');
    assert.ok(fs.existsSync(instructions), 'agent instructions are missing from the repository');
    assert.ok(fs.existsSync(skills), 'builtin skills are missing from the repository');
  });
});
