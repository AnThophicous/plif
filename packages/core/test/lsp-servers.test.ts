import assert from 'node:assert/strict';
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
