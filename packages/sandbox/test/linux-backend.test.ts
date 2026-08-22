import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import type { JailOptions, SandboxJail, SpawnOptions } from '../src/backend.js';
import { LinuxBackend } from '../src/linux/backend.js';
import { selectBackend } from '../src/index.js';

const backend = new LinuxBackend();
// Bubblewrap namespaces are available on the hosted Ubuntu runner even when
// systemd has not delegated a cgroup subtree. Keep those capabilities
// independently testable instead of making the namespace gate require both.
const requireLinuxSandbox = process.env['PLIF_REQUIRE_LINUX_SANDBOX'] === '1';
const requireLinuxCgroups = process.env['PLIF_REQUIRE_LINUX_CGROUP'] === '1';

async function available(t: TestContext): Promise<boolean> {
  const report = await backend.probe();
  if (report.isolation !== 'none') {
    if (requireLinuxCgroups) {
      assert.equal(report.accounting, true, report.degradations.join('; '));
      assert.equal(report.memoryLimit, true, report.degradations.join('; '));
      assert.equal(report.processLimit, true, report.degradations.join('; '));
      assert.equal(report.cpuLimit, true, report.degradations.join('; '));
    }
    return true;
  }
  if (requireLinuxSandbox) {
    assert.fail(report.degradations[0] ?? 'bubblewrap unavailable');
  }
  t.skip(report.degradations[0] ?? 'bubblewrap unavailable');
  return false;
}

async function fixture(
  mode: 'ro' | 'rw',
  network = false,
  limits: Partial<Pick<JailOptions, 'memoryBytes' | 'maxProcesses' | 'cpuCores'>> = {},
): Promise<{
  root: string;
  project: string;
  jail: SandboxJail;
  cleanup: () => Promise<void>;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-linux-root-'));
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-linux-project-'));
  await fs.mkdir(path.join(root, 'tmp'), { recursive: true });
  await fs.writeFile(path.join(project, 'visible.txt'), 'visible');
  await fs.writeFile(path.join(project, '.env'), 'secret');
  const options: JailOptions = {
    id: `test-${path.basename(root)}`,
    root,
    memoryBytes: limits.memoryBytes ?? 64 * 1024 * 1024,
    maxProcesses: limits.maxProcesses ?? 64,
    cpuCores: limits.cpuCores ?? 1,
    writablePaths: mode === 'rw' ? [root, project] : [root],
    allowNetwork: network,
    mounts: [{ source: project, target: '/project', mode, mask: ['/.env', '/.git/config'] }],
  };
  const jail = await backend.createJail(options);
  return {
    root,
    project,
    jail,
    cleanup: async () => {
      await jail.dispose();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(project, { recursive: true, force: true });
    },
  };
}

function spawnOptions(
  root: string,
  project: string,
  argv: readonly string[],
  signal?: AbortSignal,
): SpawnOptions {
  return {
    argv,
    cwd: project,
    virtualCwd: '/project',
    env: {
      PATH: '/usr/bin:/bin',
      TEMP: path.join(root, 'tmp'),
      TMP: path.join(root, 'tmp'),
    },
    timeoutMs: 5_000,
    maxOutputBytes: 64 * 1024,
    ...(signal ? { signal } : {}),
  };
}

async function waitForFile(file: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await fs.stat(file).then(() => true).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`file was not created: ${file}`);
}

describe('LinuxBackend', () => {
  it('reports only the kernel features it enforces', async (t) => {
    if (!(await available(t))) return;
    const report = await backend.probe();
    assert.equal(report.isolation, 'namespace');
    assert.equal(report.killProcessTree, true);
    assert.equal(report.filesystemWriteBlock, true);
    assert.equal(report.networkBlock, true);
    assert.equal(report.memoryLimit, report.accounting);
    assert.equal(report.processLimit, report.accounting);
    assert.equal(report.cpuLimit, report.accounting);
  });

  it('is selected over the portable backend on a capable Linux host', async (t) => {
    if (!(await available(t))) return;
    const selection = await selectBackend();
    assert.equal(selection.backend.id, 'linux-bubblewrap');
    assert.equal(selection.report.isolation, 'namespace');
  });

  it('enforces read-only mounts, masks and PID visibility', async (t) => {
    if (!(await available(t))) return;
    const current = await fixture('ro');
    try {
      const result = await current.jail.spawn(
        spawnOptions(current.root, current.project, [
          '/bin/sh',
          '-c',
          `test -f visible.txt && test ! -s .env && ! touch denied.txt && test ! -e /root/.ssh && test ! -e /proc/${process.pid} && printf isolated`,
        ]),
      );
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, 'isolated');
      await assert.rejects(fs.stat(path.join(current.project, 'denied.txt')));
    } finally {
      await current.cleanup();
    }
  });

  it('keeps absent masked paths inaccessible if they are created later', async (t) => {
    if (!(await available(t))) return;
    const current = await fixture('rw');
    await current.jail.dispose();
    await fs.rm(path.join(current.project, '.env'));
    let jail: SandboxJail | undefined;
    try {
      jail = await backend.createJail({
        id: `missing-mask-${path.basename(current.root)}`,
        root: current.root,
        memoryBytes: 64 * 1024 * 1024,
        maxProcesses: 64,
        cpuCores: 1,
        writablePaths: [current.root, current.project],
        allowNetwork: false,
        mounts: [{ source: current.project, target: '/project', mode: 'rw', mask: ['/.env', '/.git/config'] }],
      });
      const result = await jail.spawn(
        spawnOptions(current.root, current.project, [
          '/bin/sh',
          '-c',
          '! printf secret > .env && test ! -s .env',
        ]),
      );
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(await fs.readFile(path.join(current.project, '.env'), 'utf8'), '');
      await jail.dispose();
      jail = undefined;
      await assert.rejects(fs.stat(path.join(current.project, '.env')));
      await assert.rejects(fs.stat(path.join(current.project, '.git')));
    } finally {
      await jail?.dispose();
      await current.cleanup();
    }
  });

  it('blocks outbound networking when network is disabled', async (t) => {
    if (!(await available(t))) return;
    const current = await fixture('ro');
    try {
      const source = "const n=require('node:net');const s=n.connect(80,'1.1.1.1');s.on('connect',()=>process.exit(2));s.on('error',()=>process.exit(0));setTimeout(()=>process.exit(3),1000)";
      const result = await current.jail.spawn(
        spawnOptions(current.root, current.project, ['/usr/bin/node', '-e', source]),
      );
      assert.equal(result.exitCode, 0, result.stderr);
    } finally {
      await current.cleanup();
    }
  });

  it('stops descendants after cancellation', async (t) => {
    if (!(await available(t))) return;
    const current = await fixture('rw');
    const ticks = path.join(current.project, 'ticks');
    try {
      const cancel = new AbortController();
      const running = current.jail.spawn(
        spawnOptions(
          current.root,
          current.project,
          ['/bin/sh', '-c', 'while :; do printf x >> ticks; sleep 0.02; done'],
          cancel.signal,
        ),
      );
      await waitForFile(ticks);
      cancel.abort();
      const result = await running;
      assert.equal(result.killedBy, 'cancelled');
      const stoppedAt = (await fs.stat(ticks)).size;
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal((await fs.stat(ticks)).size, stoppedAt);
    } finally {
      await current.cleanup();
    }
  });

  it('honors cancellation while a spawn is starting', async (t) => {
    if (!(await available(t))) return;
    const current = await fixture('rw');
    try {
      const cancel = new AbortController();
      const running = current.jail.spawn(
        spawnOptions(current.root, current.project, ['/bin/sh', '-c', 'sleep 1; touch too-late'], cancel.signal),
      );
      cancel.abort();
      const result = await running;
      assert.equal(result.killedBy, 'cancelled');
      await assert.rejects(fs.stat(path.join(current.project, 'too-late')));
    } finally {
      await current.cleanup();
    }
  });

  it('kills a spawn that is still starting', async (t) => {
    if (!(await available(t))) return;
    const current = await fixture('rw');
    try {
      const running = current.jail.spawn(
        spawnOptions(current.root, current.project, ['/bin/sh', '-c', 'sleep 1; touch too-late']),
      );
      await current.jail.kill('test');
      await running;
      await assert.rejects(fs.stat(path.join(current.project, 'too-late')));
    } finally {
      await current.cleanup();
    }
  });

  it('reports cgroup memory, process and CPU usage', async (t) => {
    if (!(await available(t))) return;
    const report = await backend.probe();
    if (!report.accounting) {
      t.skip('cgroup accounting unavailable');
      return;
    }
    const current = await fixture('ro');
    try {
      const result = await current.jail.spawn(
        spawnOptions(current.root, current.project, [
          '/usr/bin/node',
          '-e',
          'const b=Buffer.alloc(8*1024*1024,1);let n=0;for(let i=0;i<2e6;i++)n+=i;process.stdout.write(String(b[0]+n>0))',
        ]),
      );
      assert.equal(result.exitCode, 0, result.stderr);
      const stats = await current.jail.stats();
      assert.ok(stats.peakMemoryBytes > 8 * 1024 * 1024);
      assert.ok(stats.cpuMillis > 0);
      assert.equal(stats.activeProcesses, 0);
      assert.equal(stats.totalProcesses, 1);
    } finally {
      await current.cleanup();
    }
  });

  it('enforces the cgroup memory ceiling', async (t) => {
    if (!(await available(t))) return;
    const report = await backend.probe();
    if (!report.memoryLimit) {
      t.skip('cgroup memory limit unavailable');
      return;
    }
    const current = await fixture('ro', false, { memoryBytes: 48 * 1024 * 1024 });
    try {
      const result = await current.jail.spawn(
        spawnOptions(current.root, current.project, [
          '/usr/bin/node',
          '-e',
          'globalThis.b=Buffer.alloc(256*1024*1024,1);setInterval(()=>{for(let i=0;i<b.length;i+=4096)b[i]^=1},10)',
        ]),
      );
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.killedBy, 'memory');
    } finally {
      await current.cleanup();
    }
  });

  it('enforces the cgroup process ceiling', async (t) => {
    if (!(await available(t))) return;
    const report = await backend.probe();
    if (!report.processLimit) {
      t.skip('cgroup process limit unavailable');
      return;
    }
    const current = await fixture('ro', false, { maxProcesses: 4 });
    try {
      const result = await current.jail.spawn(
        spawnOptions(current.root, current.project, [
          '/bin/sh',
          '-c',
          'i=0; while [ "$i" -lt 20 ]; do sleep 2 & i=$((i+1)); done; wait',
        ]),
      );
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.killedBy, 'processes');
    } finally {
      await current.cleanup();
    }
  });

  it('enforces the cgroup CPU ceiling', async (t) => {
    if (!(await available(t))) return;
    const report = await backend.probe();
    if (!report.cpuLimit) {
      t.skip('cgroup CPU limit unavailable');
      return;
    }
    const current = await fixture('ro', false, {
      memoryBytes: 128 * 1024 * 1024,
      maxProcesses: 64,
      cpuCores: 0.1,
    });
    try {
      const result = await current.jail.spawn(
        spawnOptions(current.root, current.project, [
          '/usr/bin/node',
          '-e',
          'const end=Date.now()+1000;while(Date.now()<end){}',
        ]),
      );
      assert.equal(result.exitCode, 0, result.stderr);
      const stats = await current.jail.stats();
      assert.ok(result.durationMs >= 900);
      assert.ok(stats.cpuMillis < result.durationMs / 2);
    } finally {
      await current.cleanup();
    }
  });

  it('rejects spawns after disposal', async (t) => {
    if (!(await available(t))) return;
    const current = await fixture('ro');
    await current.jail.dispose();
    await assert.rejects(
      current.jail.spawn(
        spawnOptions(current.root, current.project, ['/usr/bin/true']),
      ),
      /disposed/,
    );
    await current.cleanup();
  });

  it('does not leave a spawn running when disposal races startup', async (t) => {
    if (!(await available(t))) return;
    const current = await fixture('rw');
    const ticks = path.join(current.project, 'dispose-race');
    const running = current.jail.spawn(
      spawnOptions(current.root, current.project, [
        '/bin/sh',
        '-c',
        'while :; do printf x >> dispose-race; sleep 0.02; done',
      ]),
    ).catch(() => undefined);
    await current.jail.dispose();
    await running;
    const stoppedAt = await fs.stat(ticks).then((stat) => stat.size).catch(() => 0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const finalSize = await fs.stat(ticks).then((stat) => stat.size).catch(() => 0);
    assert.equal(finalSize, stoppedAt);
    await current.cleanup();
  });
});
