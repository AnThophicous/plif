/**
 * Policy engine tests.
 *
 * The property that matters most is the one in `evaluate`: the most restrictive
 * matching rule wins, regardless of order. Policy files get edited by people
 * under time pressure, and under first-match-wins a careless reordering is a
 * silent privilege escalation. These tests pin that down.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEVELOPER_POLICY,
  PolicyEngine,
  STRICT_POLICY,
  matchGlob,
} from '../src/policy/policy.js';
import type { PolicyDocument, PolicyRule } from '../src/policy/policy.js';
import {
  analyzeShellInvocation,
  classifyHardDeniedInvocation,
} from '../src/execution/shell-safety.js';

function policy(rules: PolicyRule[], fallback: PolicyDocument['fallback'] = 'ask'): PolicyEngine {
  return new PolicyEngine({ fallback, trust: 'trusted', rules, networkAllowlist: [] });
}

const req = (target: string, argv?: string[]) => ({
  action: 'exec' as const,
  target,
  containerId: 'test',
  ...(argv ? { argv } : {}),
});

describe('rule precedence', () => {
  const allowRule: PolicyRule = {
    name: 'allow-all',
    actions: ['exec'],
    decision: 'allow',
  };
  const denyRule: PolicyRule = {
    name: 'deny-git-push',
    actions: ['exec'],
    argvPattern: '^git push',
    decision: 'deny',
  };

  it('lets deny beat allow when both match, whatever the order', () => {
    const forwards = policy([allowRule, denyRule]).evaluate(req('git', ['git', 'push']));
    const backwards = policy([denyRule, allowRule]).evaluate(req('git', ['git', 'push']));

    assert.equal(forwards.decision, 'deny');
    assert.equal(backwards.decision, 'deny');
    assert.equal(forwards.rule?.name, 'deny-git-push');
    assert.equal(backwards.rule?.name, 'deny-git-push');
  });

  it('lets ask beat allow', () => {
    const engine = policy([
      allowRule,
      { name: 'ask-rm', actions: ['exec'], argvPattern: '^rm', decision: 'ask' },
    ]);
    assert.equal(engine.evaluate(req('rm', ['rm', '-rf', 'x'])).decision, 'ask');
  });

  it('falls back when nothing matches, and never to allow by default', () => {
    const verdict = policy([]).evaluate(req('anything'));
    assert.equal(verdict.decision, 'ask');
    assert.equal(verdict.rule, null);
    assert.equal(STRICT_POLICY.fallback, 'ask');
    assert.equal(DEVELOPER_POLICY.fallback, 'ask');
  });
});

describe('the unconditional exec denylist', () => {
  const permissive = policy([{ name: 'allow-everything', actions: '*', decision: 'allow' }], 'allow');

  it('cannot be overridden by an allow-everything rule', () => {
    for (const command of ['vssadmin', 'bcdedit', 'takeown', 'diskpart', 'runas']) {
      const verdict = permissive.evaluate(req(command, [command, 'whatever']));
      assert.equal(verdict.decision, 'deny', `${command} should be denied unconditionally`);
    }
  });

  it('matches on the bare command name, so a full path does not slip past', () => {
    const verdict = permissive.evaluate(
      req('C:\\Windows\\System32\\vssadmin.exe', ['C:\\Windows\\System32\\vssadmin.exe', 'list']),
    );
    assert.equal(verdict.decision, 'deny');
  });

  it('does not catch unrelated commands that merely contain a denied word', () => {
    assert.notEqual(permissive.evaluate(req('netstat', ['netstat', '-a'])).decision, 'deny');
  });

  const nestedDenials: readonly (readonly string[])[] = [
    ['powershell.exe', '-NoProfile', '-Command', 'vssadmin delete shadows /all'],
    ['pwsh.exe', '-NoProfile', '-Command', 'Get-Date; netsh advfirewall set allprofiles state off'],
    ['bash', '-c', 'printf ok; sudo id'],
    ['sh', '-c', 'dd if=/dev/zero of=/dev/sda'],
    ['cmd.exe', '/d', '/s', '/c', 'echo ok & schtasks /create /tn x /tr calc'],
    ['pwsh.exe', '-Command', "bash -c 'printf ok; sudo id'"],
  ];

  for (const argv of nestedDenials) {
    it(`hard-denies commands nested in ${argv[0]}`, () => {
      const verdict = permissive.evaluate(req(argv[0]!, [...argv]));
      assert.equal(verdict.decision, 'deny');
      assert.equal(verdict.rule, null);
    });
  }

  it('fails closed on opaque interpreter envelopes before permissive policy rules', () => {
    const opaque: readonly (readonly string[])[] = [
      ['pwsh.exe', '-EncodedCommand', 'dmFsaWQ='],
      ['powershell.exe', '-e', 'dmFsaWQ='],
      ['pwsh.exe', '-File', 'script.ps1'],
      ['pwsh.exe', '-ExecutionPolicy', 'Bypass', '-Command', 'Get-Date'],
      ['pwsh.exe', '-Command', '-'],
      ['pwsh.exe', '-Command', 'Invoke-Expression $payload'],
      ['pwsh.exe', '-Command', '& $program'],
      ['pwsh.exe', '-Command', 'Start-Process $program'],
      ['bash', '-lc', 'npm test'],
      ['cmd.exe', '/k', 'echo unsafe'],
    ];

    for (const argv of opaque) {
      const analysis = analyzeShellInvocation(argv);
      assert.equal(analysis.state, 'opaque', argv.join(' '));
      assert.equal(permissive.evaluate(req(argv[0]!, [...argv])).decision, 'deny');
    }
  });

  it('fails closed on malformed interpreter envelopes', () => {
    const malformed: readonly (readonly string[])[] = [
      ['pwsh.exe', '-Command'],
      ['pwsh.exe', '-Command', "Write-Output 'unterminated"],
      ['bash', '-c'],
      ['cmd.exe', '/c'],
    ];

    for (const argv of malformed) {
      assert.equal(analyzeShellInvocation(argv).state, 'malformed', argv.join(' '));
      assert.equal(permissive.evaluate(req(argv[0]!, [...argv])).decision, 'deny');
    }
  });

  it('does not mistake denied words in strings or comments for commands', () => {
    const safe: readonly (readonly string[])[] = [
      ['pwsh.exe', '-Command', "Write-Output 'vssadmin'; # netsh"],
      ['bash', '-c', "printf '%s\\n' 'sudo'; # dd if=/dev/zero of=/dev/sda"],
      ['cmd.exe', '/d', '/c', 'echo vssadmin & rem netsh'],
    ];

    for (const argv of safe) {
      assert.equal(analyzeShellInvocation(argv).state, 'static-envelope', argv.join(' '));
      assert.equal(classifyHardDeniedInvocation(argv), null, argv.join(' '));
      assert.equal(permissive.evaluate(req(argv[0]!, [...argv])).decision, 'allow');
    }
  });

  it('keeps safe static envelopes and foreground recursive deletion policy-controlled', () => {
    const policyControlled: readonly (readonly string[])[] = [
      ['pwsh.exe', '-NoProfile', '-Command', 'Get-ChildItem | Select-Object -First 5'],
      ['pwsh.exe', '-Command', 'npm test | Tee-Object test.log'],
      ['bash', '-c', 'npm test'],
      ['rm', '-rf', './generated'],
    ];

    for (const argv of policyControlled) {
      assert.equal(classifyHardDeniedInvocation(argv), null, argv.join(' '));
      assert.equal(permissive.evaluate(req(argv[0]!, [...argv])).decision, 'allow');
    }
  });
});

describe('capability of restrict()', () => {
  it('intersects the network allowlist rather than unioning it', () => {
    const parent = new PolicyEngine({
      fallback: 'ask',
      trust: 'trusted',
      rules: [],
      networkAllowlist: ['github.com'],
    });
    // A child asking for a host the parent cannot reach must not gain it.
    const child = parent.restrict({ networkAllowlist: ['github.com', 'evil.example'] });

    assert.equal(child.allowsHost('github.com'), true);
    assert.equal(child.allowsHost('evil.example'), false);
  });

  it('takes the more restrictive fallback', () => {
    const parent = new PolicyEngine({
      fallback: 'ask',
      trust: 'trusted',
      rules: [],
      networkAllowlist: [],
    });
    assert.equal(parent.restrict({ fallback: 'deny' }).document.fallback, 'deny');
    assert.equal(parent.restrict({ fallback: 'allow' }).document.fallback, 'ask');
  });
});

describe('allowsHost', () => {
  const engine = new PolicyEngine({
    fallback: 'deny',
    trust: 'trusted',
    rules: [],
    networkAllowlist: ['github.com'],
  });

  it('accepts the host itself and its subdomains', () => {
    assert.equal(engine.allowsHost('github.com'), true);
    assert.equal(engine.allowsHost('api.github.com'), true);
    assert.equal(engine.allowsHost('github.com:443'), true);
  });

  it('rejects a lookalike that merely ends with the same characters', () => {
    assert.equal(engine.allowsHost('notgithub.com'), false);
    assert.equal(engine.allowsHost('github.com.evil.test'), false);
  });
});

describe('matchGlob', () => {
  it('stops * at a segment boundary and lets ** cross it', () => {
    assert.equal(matchGlob('/workspace/*', '/workspace/a.ts'), true);
    assert.equal(matchGlob('/workspace/*', '/workspace/src/a.ts'), false);
    assert.equal(matchGlob('/workspace/**', '/workspace/src/deep/a.ts'), true);
  });

  it('matches the dotfile pattern the secrets rule relies on', () => {
    assert.equal(matchGlob('/workspace/**/.env*', '/workspace/api/.env.local'), true);
    assert.equal(matchGlob('/workspace/**/.env*', '/workspace/.env'), true);
    assert.equal(matchGlob('/workspace/**/.env*', '/workspace/src/index.ts'), false);
  });
});

describe('validation', () => {
  it('rejects duplicate rule names, since the audit log keys on them', () => {
    assert.throws(() =>
      policy([
        { name: 'dup', actions: ['exec'], decision: 'allow' },
        { name: 'dup', actions: ['exec'], decision: 'deny' },
      ]),
    );
  });

  it('rejects an unparseable argvPattern at construction, not at first use', () => {
    assert.throws(() =>
      policy([{ name: 'bad', actions: ['exec'], argvPattern: '([', decision: 'deny' }]),
    );
  });
});

describe('the shipped policies', () => {
  it('protect git internals from writes', () => {
    const engine = new PolicyEngine(DEVELOPER_POLICY);
    const verdict = engine.evaluate({
      action: 'fs.write',
      target: '/workspace/.git/config',
      containerId: 'test',
    });
    assert.equal(verdict.decision, 'deny');
  });

  it('allow ordinary source writes without asking', () => {
    const engine = new PolicyEngine(DEVELOPER_POLICY);
    const verdict = engine.evaluate({
      action: 'fs.write',
      target: '/workspace/src/index.ts',
      containerId: 'test',
    });
    assert.equal(verdict.decision, 'allow');
  });

  it('escalate a read of a .env file', () => {
    const engine = new PolicyEngine(DEVELOPER_POLICY);
    const verdict = engine.evaluate({
      action: 'fs.read',
      target: '/workspace/.env',
      containerId: 'test',
    });
    assert.equal(verdict.decision, 'ask');
  });

  it('give the strict policy an untrusted tier so it demands real isolation', () => {
    assert.equal(STRICT_POLICY.trust, 'untrusted');
    assert.equal(STRICT_POLICY.networkAllowlist.length, 0);
  });
});
