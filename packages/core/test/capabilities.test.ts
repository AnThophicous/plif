/**
 * The capability ceiling.
 *
 * Two rules that pull in opposite directions and must both hold:
 *
 *   1. An image is a **ceiling**. A container can never hold a capability the
 *      image withholds, however loudly its spec asks.
 *   2. A container **defaults closed**. Omitting a capability from the spec
 *      means "withheld", not "inherit whatever the image happens to allow".
 *
 * Getting only the first right is what broke `--write`: the base image withheld
 * `hostWrite`, the intersection always won, and no container could ever write
 * to the host no matter what the flag said. Raising the ceiling fixed that and
 * immediately created the opposite hazard — every container that forgot to
 * mention `hostWrite` would silently inherit it. Rule 2 is what closes that,
 * and it is the one a refactor is most likely to drop.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { Engine } from '../src/container/engine.js';
import { PortableBackend } from '@plif/sandbox';

describe('capability resolution', () => {
  let root: string;
  let engine: Engine;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-caps-'));
    // The portable backend keeps this fast and avoids needing real isolation.
    engine = new Engine({ root, backend: new PortableBackend() });
    await engine.start();
  });

  after(async () => {
    await engine.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('defaults a container closed even though the base image ceiling is open', async () => {
    const image = await engine.ensureBaseImage();
    // The ceiling permits these, which is what makes them grantable at all.
    assert.equal(image.config.capabilities.hostWrite, true);
    assert.equal(image.config.capabilities.network, true);

    const container = await engine.create({ image: image.reference, mounts: [] });

    // …and yet a spec that says nothing gets none of them.
    assert.equal(container.capabilities.hostWrite, false);
    assert.equal(container.capabilities.network, false);
    assert.equal(container.capabilities.spawnContainers, false);
    // The everyday ones stay on, or the container would be useless.
    assert.equal(container.capabilities.fsRead, true);
    assert.equal(container.capabilities.exec, true);
  });

  it('grants a capability only when the spec asks for it', async () => {
    const image = await engine.ensureBaseImage();
    const container = await engine.create({
      image: image.reference,
      mounts: [],
      capabilities: { hostWrite: true },
    });

    assert.equal(container.capabilities.hostWrite, true);
    // Asking for one thing must not quietly bring its neighbours along.
    assert.equal(container.capabilities.network, false);
  });

  it('cannot exceed the image ceiling', async () => {
    const image = await engine.ensureBaseImage();
    const locked = await engine.images.build({
      reference: 'test/locked:1',
      layers: [...image.layers],
      config: { ...image.config, capabilities: { ...image.config.capabilities, hostWrite: false } },
    });

    const container = await engine.create({
      image: locked.reference,
      mounts: [],
      capabilities: { hostWrite: true },
    });

    // The spec asked; the image said no. The image wins.
    assert.equal(container.capabilities.hostWrite, false);
  });

  it('rebuilds the base image so a changed definition takes effect', async () => {
    // Caching the tagged image meant a fixed ceiling stayed broken on any
    // machine that had run once before the fix. Two calls must agree, and both
    // must reflect the current definition rather than whatever is on disk.
    const first = await engine.ensureBaseImage();
    const second = await engine.ensureBaseImage();

    assert.equal(first.digest, second.digest, 'rebuilding changed the digest');
    assert.equal(second.config.capabilities.hostWrite, true);
  });

  it('refuses an rw host mount when the backend cannot enforce host-write confinement', async () => {
    const workspace = await fs.mkdtemp(path.join(root, 'host-mount-'));
    const image = await engine.ensureBaseImage();
    const container = await engine.create({
      image: image.reference,
      mounts: [{ source: workspace, target: '/project', mode: 'rw' }],
      name: 'unconfined-rw-test',
    });
    await assert.rejects(
      () => container.start(),
      (error: unknown) => error instanceof Error && /host-write confinement/.test(error.message),
    );
    await engine.remove('unconfined-rw-test');
  });

  it('refuses a read-only host mount when the backend cannot enforce process writes', async () => {
    const workspace = await fs.mkdtemp(path.join(root, 'ro-host-mount-'));
    const image = await engine.ensureBaseImage();
    const container = await engine.create({
      image: image.reference,
      mounts: [{ source: workspace, target: '/project', mode: 'ro' }],
      name: 'unconfined-ro-test',
    });
    await assert.rejects(
      () => container.start(),
      (error: unknown) => error instanceof Error && /host-write confinement/.test(error.message),
    );
    await engine.remove('unconfined-ro-test');
  });

  it('asks before exec on a host mount when OS write isolation is absent', async () => {
    const workspace = await fs.mkdtemp(path.join(root, 'host-mount-exec-'));
    const image = await engine.ensureBaseImage();
    const container = await engine.run({
      image: image.reference,
      mounts: [{ source: workspace, target: '/project', mode: 'rw' }],
      capabilities: { hostWrite: true },
      name: 'host-mount-exec-approval',
    });
    let asked = 0;
    const unsubscribe = engine.bus.on('approval.request', (request) => {
      if (request.containerId !== container.id) return;
      asked += 1;
      engine.approvals.respond(request.id, { decision: 'allow', remember: false });
    });
    try {
      const result = await container.exec({
        argv: ['node', '--version'],
        cwd: '/project',
        reason: 'verify host-backed execution approval',
      });
      assert.equal(result.exitCode, 0);
      assert.equal(asked, 1);
    } finally {
      unsubscribe();
      await container.stop('test complete');
    }
  });

  it('redacts secrets from approval prompts as well as audit records', async () => {
    const image = await engine.ensureBaseImage();
    const container = await engine.run({ image: image.reference, mounts: [], name: 'approval-redaction-test' });
    const secret = 'approval-secret-value-9f4c';
    let requestSeen: { argv: readonly string[] | undefined; reason: string } | undefined;
    const unsubscribe = engine.bus.on('approval.request', (request) => {
      if (request.containerId !== container.id) return;
      requestSeen = request;
      engine.approvals.respond(request.id, { decision: 'allow', remember: false });
    });
    try {
      const result = await container.exec({
        argv: ['command-that-does-not-exist', secret],
        env: { PLIF_APPROVAL_SECRET: secret },
        reason: `diagnose ${secret}`,
      });
      assert.equal(result.exitCode, 127);
      assert.ok(requestSeen);
      assert.deepEqual(requestSeen.argv, ['command-that-does-not-exist', '[secret omitted]']);
      assert.ok(!requestSeen.reason.includes(secret));
    } finally {
      unsubscribe();
      await container.stop('test complete');
    }
  });

  it('does not leave a failed atomic run registered in the engine', async () => {
    const workspace = await fs.mkdtemp(path.join(root, 'atomic-run-'));
    const image = await engine.ensureBaseImage();
    await assert.rejects(
      () => engine.run({
        image: image.reference,
        mounts: [{ source: workspace, target: '/project', mode: 'rw' }],
        name: 'atomic-run-fails-cleanly',
      }),
      /host-write confinement/,
    );
    assert.equal(engine.get('atomic-run-fails-cleanly'), null);
  });

  it('enforces the network allowlist before opening a connection', async () => {
    const image = await engine.ensureBaseImage();
    const container = await engine.run({
      image: image.reference,
      mounts: [],
      capabilities: { network: true },
      name: 'network-allowlist-test',
    });
    try {
      await assert.rejects(
        () => container.reachNetwork('evil.example', 'test'),
        (error: unknown) => error instanceof Error && /not in the policy allowlist/.test(error.message),
      );
    } finally {
      await container.stop('test complete');
    }
  });
});
