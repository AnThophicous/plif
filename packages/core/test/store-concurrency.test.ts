import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { AuditLog } from '../src/audit/log.js';
import { ImageStore } from '../src/store/images.js';
import { StorePaths } from '../src/store/paths.js';

describe('cross-instance stores', () => {
  let root: string;
  let paths: StorePaths;
  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-store-race-'));
    paths = new StorePaths(root);
  });
  after(async () => fs.rm(root, { recursive: true, force: true }));

  it('serializes the audit sequence and hash chain across instances', async () => {
    const first = new AuditLog(paths);
    const second = new AuditLog(paths);
    await Promise.all([
      first.append('agent.turn', null, { owner: 'first' }),
      second.append('agent.turn', null, { owner: 'second' }),
    ]);
    const records = [];
    for await (const record of first.read()) records.push(record);
    assert.deepEqual(records.map((record) => record.seq), [1, 2]);
    assert.equal((await first.verify()).ok, true);
  });

  it('does not lose tags written concurrently by different instances', async () => {
    const first = new ImageStore(paths);
    const second = new ImageStore(paths);
    await Promise.all([
      first.tag('one', 'a'.repeat(64)),
      second.tag('two', 'b'.repeat(64)),
    ]);
    assert.deepEqual(await first.tagsFor('a'.repeat(64)), ['one:latest']);
    assert.deepEqual(await second.tagsFor('b'.repeat(64)), ['two:latest']);
  });
});
