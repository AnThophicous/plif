import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { Engine } from '../src/container/engine.js';

describe('Linux container integration', () => {
  it('runs through Engine with an exact writable workspace mount', async (t) => {
    if (process.platform !== 'linux') {
      t.skip('Linux only');
      return;
    }
    const store = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-engine-test-'));
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-workspace-test-'));
    const engine = new Engine({ root: store });
    engine.approvals.setAutoApprove(true);
    try {
      const report = await engine.start();
      if (report.isolation === 'none') {
        t.skip(report.degradations[0] ?? 'Linux sandbox unavailable');
        return;
      }
      const image = await engine.ensureBaseImage();
      const container = await engine.run({
        image: image.reference,
        mounts: [{ source: workspace, target: '/project', mode: 'rw' }],
        workdir: '/project',
        capabilities: { hostWrite: true, network: false },
      });
      const result = await container.exec({
        argv: ['/bin/sh', '-c', 'printf integrated > result.txt && cat result.txt'],
      });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, 'integrated');
      assert.equal(await fs.readFile(path.join(workspace, 'result.txt'), 'utf8'), 'integrated');
      assert.ok(container.status().usage.peakMemoryBytes > 0);
      await container.stop('test complete');
    } finally {
      await engine.shutdown();
      await fs.rm(store, { recursive: true, force: true });
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
