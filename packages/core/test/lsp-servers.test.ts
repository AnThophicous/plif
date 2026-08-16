import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { languageIdFor, resolveServer, serverFor } from '../src/lsp/servers.js';

describe('shell language servers', () => {
  it('routes Bash-family files to bash-language-server', () => {
    assert.equal(languageIdFor('script.sh'), 'shellscript');
    assert.equal(serverFor('script.bash')?.id, 'bash');
  });

  it('routes PowerShell files to PowerShell Editor Services', () => {
    assert.equal(languageIdFor('module.psm1'), 'powershell');
    assert.equal(serverFor('settings.psd1')?.id, 'powershell');
  });
});

describe('JSON language server', () => {
  it('routes JSON and JSONC independently', () => {
    assert.equal(languageIdFor('package.json'), 'json');
    assert.equal(languageIdFor('settings.jsonc'), 'jsonc');
    assert.equal(serverFor('schema.json')?.id, 'json');
  });

  it('falls back to the server bundled with Plif', async () => {
    const spec = serverFor('config.jsonc');
    assert.ok(spec);
    const resolved = await resolveServer(spec, process.cwd());
    assert.ok(resolved);
    assert.equal(resolved.source, 'bundled');
    assert.equal(resolved.args.includes('--stdio'), true);
  });
});

describe('bundled web language servers', () => {
  it('ships TypeScript, HTML and CSS support without a global install', async () => {
    for (const file of ['src/app.tsx', 'public/index.html', 'src/styles.css']) {
      const spec = serverFor(file);
      assert.ok(spec, file);
      const resolved = await resolveServer(spec, process.cwd());
      assert.ok(resolved, file);
      assert.equal(resolved.source, 'bundled', file);
    }
  });
});

describe('TOML language server', () => {
  it('routes config.toml to Taplo when it is installed', () => {
    assert.equal(languageIdFor('config.toml'), 'toml');
    const spec = serverFor('config.toml');
    assert.equal(spec?.id, 'toml');
    assert.deepEqual(spec?.args, ['lsp', 'stdio']);
  });
});

describe('Windows language-server shims', () => {
  it('launches a .cmd shim through cmd.exe without losing quoted arguments', async () => {
    if (process.platform !== 'win32') return;

    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif lsp shim-'));
    const bin = path.join(root, 'node_modules', '.bin');
    const shim = path.join(bin, 'fake-language-server.cmd');
    await fs.mkdir(bin, { recursive: true });
    await fs.writeFile(
      shim,
      '@echo off\r\nnode -e "process.stdout.write(JSON.stringify(process.argv.slice(1)))" %*\r\n',
    );

    const spec: ServerSpec = {
      id: 'fake',
      label: 'Fake',
      languageIds: ['fake'],
      extensions: ['.fake'],
      markers: [],
      bin: 'fake-language-server',
      args: ['hello world', 'safe&value'],
      install: 'none',
    };

    try {
      const resolved = await resolveServer(spec, root);
      assert.ok(resolved);
      assert.equal(resolved.source, 'project');
      assert.equal(resolved.command.toLowerCase(), (process.env['ComSpec'] ?? process.env['COMSPEC'] ?? 'cmd.exe').toLowerCase());
      assert.deepEqual(resolved.args.slice(0, 3), ['/d', '/s', '/c']);
      assert.equal(resolved.windowsVerbatimArguments, true);

      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(resolved.command, [...resolved.args], {
          windowsVerbatimArguments: resolved.windowsVerbatimArguments,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer | string) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code !== 0) reject(new Error(`shim exited ${code}: ${stderr}`));
          else resolve(stdout);
        });
      });

      assert.deepEqual(JSON.parse(output.trim()), ['hello world', 'safe&value']);
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
