import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { PortableBackend } from '@plif/sandbox';

import { PlifError } from '../src/errors.js';
import { Engine } from '../src/container/engine.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('Container runtime environment', () => {
  it('injects and removes values for future execs without exposing them in status', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-container-env-'));
    roots.push(root);
    const engine = new Engine({ root, backend: new PortableBackend() });
    await engine.start();
    const image = await engine.ensureBaseImage();
    const container = await engine.run({ image: image.reference, mounts: [], name: 'env-runtime-test' });
    const secret = 'container-secret-not-in-status';

    try {
      const before = await container.exec({
        argv: ['node', '-e', "process.stdout.write(process.env.PLIF_TEST_SECRET ?? '')"],
      });
      assert.equal(before.stdout, '');

      const applied = container.applyEnvironment({ PLIF_TEST_SECRET: secret });
      assert.deepEqual(applied.names, ['PLIF_TEST_SECRET']);
      assert.equal(JSON.stringify(applied).includes(secret), false);
      const persistedSpec = await fs.readFile(engine.paths.containerSpec(container.id), 'utf8');
      assert.equal(persistedSpec.includes(secret), false);

      const injected = await container.exec({
        argv: ['node', '-e', "process.stdout.write(process.env.PLIF_TEST_SECRET ?? '')"],
      });
      assert.equal(injected.stdout, '[secret omitted]');
      assert.equal(container.redactSensitiveOutput(`seen ${secret}`), 'seen [secret omitted]');

      const presence = await container.exec({
        argv: ['node', '-e', "process.stdout.write(process.env.PLIF_TEST_SECRET ? 'injected' : 'missing')"],
      });
      assert.equal(presence.stdout, 'injected');

      const removed = container.removeEnvironment({ PLIF_TEST_SECRET: 'ignored-by-design' });
      assert.deepEqual(removed.names, []);
      const after = await container.exec({
        argv: ['node', '-e', "process.stdout.write(process.env.PLIF_TEST_SECRET ?? '')"],
      });
      assert.equal(after.stdout, '');
    } finally {
      await engine.shutdown();
    }
  });

  it('does not allow a runtime environment to be configured before the container runs', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-container-env-state-'));
    roots.push(root);
    const engine = new Engine({ root, backend: new PortableBackend() });
    await engine.start();
    const image = await engine.ensureBaseImage();
    const container = await engine.create({ image: image.reference, mounts: [], name: 'env-state-test' });

    try {
      assert.throws(
        () => container.applyEnvironment({ PLIF_TEST_SECRET: 'not-applied' }),
        (error: unknown) => error instanceof PlifError && error.code === 'CONTAINER_BAD_STATE',
      );
      await container.start();
      container.applyEnvironment({ PLIF_TEST_SECRET: 'applied-after-start' });
      const result = await container.exec({
        argv: ['node', '-e', "process.stdout.write(process.env.PLIF_TEST_SECRET ? 'injected' : 'missing')"],
      });
      assert.equal(result.stdout, 'injected');
    } finally {
      await engine.shutdown();
    }
  });

  it('does not copy arbitrary host variables into a child environment', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-container-env-host-'));
    roots.push(root);
    const hostName = 'PLIF_HOST_SECRET_FOR_ENV_TEST';
    const previous = process.env[hostName];
    process.env[hostName] = 'host-secret-must-not-cross';
    const engine = new Engine({ root, backend: new PortableBackend() });
    await engine.start();
    const image = await engine.ensureBaseImage();
    const container = await engine.run({ image: image.reference, mounts: [], name: 'env-host-test' });

    try {
      const result = await container.exec({
        argv: ['node', '-e', `process.stdout.write(process.env.${hostName} ? 'leaked' : 'safe')`],
      });
      assert.equal(result.stdout, 'safe');
    } finally {
      await engine.shutdown();
      if (previous === undefined) delete process.env[hostName];
      else process.env[hostName] = previous;
    }
  });
});
