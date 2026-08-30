import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, it } from 'node:test';

import { checkForUpdate, isNewer } from '../src/update/check.js';

async function scratch(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-update-'));
  return path.join(root, 'update-check.json');
}

function packageTarball(version: string): Uint8Array {
  const contents = `# Changelog\n\n## [${version}]\n\n- Test release.\n`;
  const body = Buffer.from(contents, 'utf8');
  const header = Buffer.alloc(512);
  header.write('package/CHANGELOG.md', 0, 'utf8');
  header.write('0000644', 100, 'ascii');
  header.write('0000000', 108, 'ascii');
  header.write('0000000', 116, 'ascii');
  header.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  header.write('00000000000\0', 136, 'ascii');
  header.fill(0x20, 148, 156);
  header.write('0', 156, 'ascii');
  header.write('ustar\0', 257, 'ascii');
  const checksum = header.reduce((total, value) => total + value, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
  body.copy(padded);
  return gzipSync(Buffer.concat([header, padded, Buffer.alloc(1024)]));
}

const served = (version: unknown, status = 200): typeof fetch =>
  (async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith('.tgz')) return new Response(packageTarball(String(version)), { status: 200 });
    const metadata = typeof version === 'string'
      ? { version, dist: { tarball: 'https://registry.npmjs.org/@plif/cli/-/cli.tgz', integrity: 'sha512-AAAAAAAAAAAAAAAA' } }
      : { version };
    return new Response(JSON.stringify(metadata), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

describe('comparing versions', () => {
  it('orders the parts numerically, not as text', () => {
    assert.equal(isNewer('0.10.0', '0.9.0'), true);
    assert.equal(isNewer('0.9.0', '0.10.0'), false);
    assert.equal(isNewer('1.0.0', '0.99.99'), true);
  });

  it('is not fooled by a v prefix', () => {
    assert.equal(isNewer('v0.2.0', '0.1.0'), true);
  });

  it('treats the same version as nothing to do', () => {
    assert.equal(isNewer('0.1.0', '0.1.0'), false);
  });

  it('sorts a prerelease below the release it precedes', () => {
    assert.equal(isNewer('0.2.0-rc.1', '0.2.0'), false);
    assert.equal(isNewer('0.2.0', '0.2.0-rc.1'), true);
  });
});

describe('checking for an update', () => {
  it('reports a newer version with the command that installs it', async () => {
    const update = await checkForUpdate({
      current: '0.1.0',
      cacheFile: await scratch(),
      environment: {},
      fetchImpl: served('0.2.0'),
    });

    assert.equal(update?.latest, '0.2.0');
    assert.equal(update?.behind, true);
    assert.match(update?.command ?? '', /npm install -g @plif\/cli@latest/);
  });

  it('says nothing when there is nothing to say', async () => {
    const update = await checkForUpdate({
      current: '0.2.0',
      cacheFile: await scratch(),
      environment: {},
      fetchImpl: served('0.2.0'),
    });

    assert.equal(update, null);
  });

  it('does not reach the network when opted out', async () => {
    let called = false;
    const update = await checkForUpdate({
      current: '0.1.0',
      cacheFile: await scratch(),
      environment: { PLIF_NO_UPDATE_CHECK: '1' },
      fetchImpl: (async () => {
        called = true;
        return new Response('{}');
      }) as unknown as typeof fetch,
    });

    assert.equal(update, null);
    assert.equal(called, false, 'CI images set this to stop the phone-home');
  });

  it('swallows an offline registry rather than failing a launch', async () => {
    const update = await checkForUpdate({
      current: '0.1.0',
      cacheFile: await scratch(),
      environment: {},
      fetchImpl: (async () => {
        throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org');
      }) as unknown as typeof fetch,
    });

    assert.equal(update, null);
  });

  it('swallows a registry that answers with rubbish', async () => {
    const update = await checkForUpdate({
      current: '0.1.0',
      cacheFile: await scratch(),
      environment: {},
      fetchImpl: served({ not: 'a version' }),
    });

    assert.equal(update, null);
  });

  it('asks once, then reads its own cache', async () => {
    const cacheFile = await scratch();
    let requests = 0;
    const counting = (async () => {
      requests += 1;
      return requests % 2 === 1
        ? new Response(JSON.stringify({ version: '0.3.0', dist: { tarball: 'https://registry.npmjs.org/@plif/cli/-/cli.tgz' } }))
        : new Response(packageTarball('0.3.0'));
    }) as unknown as typeof fetch;

    const first = await checkForUpdate({
      current: '0.1.0',
      cacheFile,
      environment: {},
      fetchImpl: counting,
    });
    const second = await checkForUpdate({
      current: '0.1.0',
      cacheFile,
      environment: {},
      fetchImpl: counting,
    });

    assert.equal(first?.latest, '0.3.0');
    assert.equal(second?.latest, '0.3.0');
    assert.equal(requests, 2, 'launching plif must not be an npm request every time');
  });

  it('goes back to the registry once the cache is stale', async () => {
    const cacheFile = await scratch();
    let requests = 0;
    const counting = (async () => {
      requests += 1;
      return requests % 2 === 1
        ? new Response(JSON.stringify({ version: '0.3.0', dist: { tarball: 'https://registry.npmjs.org/@plif/cli/-/cli.tgz' } }))
        : new Response(packageTarball('0.3.0'));
    }) as unknown as typeof fetch;

    await checkForUpdate({ current: '0.1.0', cacheFile, environment: {}, fetchImpl: counting });
    await checkForUpdate({
      current: '0.1.0',
      cacheFile,
      environment: {},
      fetchImpl: counting,
      ttlMs: 0,
    });

    assert.equal(requests, 4);
  });
});
