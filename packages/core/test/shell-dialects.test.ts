import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyzeShellInvocation, classifyHardDeniedInvocation } from '../src/execution/shell-safety.js';
import {
  BashDialect,
  PowerShellDialect,
  resolveShellDialect,
} from '../src/execution/shell-dialects.js';
import type { ShellReport } from '../src/harness/environment.js';

function report(platform: NodeJS.Platform, interpreters: readonly string[]): ShellReport {
  return {
    platform,
    osLabel: platform,
    arch: 'x64',
    interpreters,
    utilities: [],
    posixTools: interpreters.some((name) => /^(?:bash|sh)(?:\.exe)?$/i.test(name)),
  };
}

describe('shell dialects', () => {
  it('prefers PowerShell 7 and passes the script as exactly one argv element', () => {
    const resolved = resolveShellDialect(report('win32', ['powershell.exe', 'pwsh.exe']));
    const script = 'Get-ChildItem | Select-Object -First 1';

    assert.equal(resolved.dialect?.id, 'powershell');
    assert.deepEqual(resolved.dialect?.argv(script), [
      'pwsh.exe',
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ]);
  });

  it('falls back to Windows PowerShell without inventing an executable', () => {
    const resolved = resolveShellDialect(report('win32', ['powershell.exe']));
    assert.equal(resolved.dialect?.executable, 'powershell.exe');
  });

  it('never selects Bash on Windows', () => {
    const resolved = resolveShellDialect(report('win32', ['bash.exe']));
    assert.equal(resolved.dialect, null);
    assert.match(resolved.reason ?? '', /PowerShell/i);
  });

  it('keeps the future Bash adapter profile-free', () => {
    const dialect = new BashDialect('bash');
    assert.deepEqual(dialect.argv('npm test | tee test.log'), [
      'bash',
      '--noprofile',
      '--norc',
      '-c',
      'npm test | tee test.log',
    ]);
  });

  it('round-trips every emitted argv through the safety analyzer', () => {
    for (const dialect of [new PowerShellDialect('pwsh.exe'), new BashDialect('bash')]) {
      const argv = dialect.argv('npm test | tee test.log');
      const analysis = analyzeShellInvocation(argv);
      assert.equal(analysis.state, 'static-envelope', dialect.id);
      assert.equal(analysis.script, 'npm test | tee test.log');
      assert.equal(classifyHardDeniedInvocation(argv), null);
    }
  });
});
