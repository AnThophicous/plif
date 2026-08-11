import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PlifError } from '../src/errors.js';
import { EventBus } from '../src/events/bus.js';
import { PowerShellDialect } from '../src/execution/shell-dialects.js';
import type { ShellDialectResolution } from '../src/execution/shell-dialects.js';
import { QuestionBroker } from '../src/harness/ask.js';
import { runLoop } from '../src/harness/loop.js';
import { subagentTools } from '../src/harness/subagent.js';
import {
  DEFAULT_TOOLS,
  shellCommand,
  toolsForEnvironment,
} from '../src/harness/tools.js';
import type { ToolContext } from '../src/harness/tools.js';
import type { CompletionEvent, ModelProvider } from '../src/model/provider.js';
import type { ExecRequest, ExecResult } from '../src/types.js';

const dialect = new PowerShellDialect('pwsh.exe');
const supported: ShellDialectResolution = { dialect, reason: null };

function result(overrides: Partial<ExecResult> = {}): ExecResult {
  return {
    exitCode: 0,
    stdout: 'ok\n',
    stderr: '',
    truncated: false,
    durationMs: 7,
    ...overrides,
  };
}

function harness(execResult: ExecResult = result(), signal?: AbortSignal): {
  readonly context: ToolContext;
  readonly requests: ExecRequest[];
} {
  const requests: ExecRequest[] = [];
  const container = {
    async exec(request: ExecRequest): Promise<ExecResult> {
      requests.push(request);
      return execResult;
    },
  };
  return {
    context: {
      container,
      shellDialect: dialect,
      signal,
    } as unknown as ToolContext,
    requests,
  };
}

describe('shell_command', () => {
  it('passes one script element through the exact dialect argv', async () => {
    const run = harness();
    const script = '$items = Get-ChildItem; $items | Select-Object -First 2';
    const output = await shellCommand.run({ script, reason: 'inspect files' }, run.context);

    assert.deepEqual(run.requests[0]?.argv, [
      'pwsh.exe',
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ]);
    assert.equal(run.requests[0]?.reason, 'inspect files');
    assert.equal(output.ok, true);
    assert.match(output.output, /^exit 0/m);
    assert.match(output.output, /stdout:\nok/);
  });

  it('preserves stderr on a successful exit', async () => {
    const run = harness(result({ stderr: 'warning\n' }));
    const output = await shellCommand.run({ script: 'Write-Warning warning', reason: 'test' }, run.context);
    assert.equal(output.ok, true);
    assert.match(output.output, /stderr:\nwarning/);
  });

  it('reports nonzero exit, cancellation, and truncation like run_command', async () => {
    const controller = new AbortController();
    controller.abort();
    const run = harness(result({
      exitCode: 9,
      stderr: 'failed\n',
      killedBy: 'cancelled',
      truncated: true,
    }), controller.signal);
    const output = await shellCommand.run({ script: 'npm test', reason: 'test' }, run.context);

    assert.equal(run.requests[0]?.signal, controller.signal);
    assert.equal(output.ok, false);
    assert.match(output.output, /exit 9 \(cancelled\)/);
    assert.match(output.output, /output truncated/);
    assert.match(output.display ?? '', /failed/);
  });

  it('returns a typed unsupported failure if a stale caller has no dialect', async () => {
    const run = harness();
    const context = { ...run.context, shellDialect: undefined } as ToolContext;
    await assert.rejects(
      shellCommand.run({ script: 'Get-Date', reason: 'test' }, context),
      (error: unknown) => error instanceof PlifError && error.code === 'SHELL_UNSUPPORTED',
    );
    assert.equal(run.requests.length, 0);
  });

  it('rejects NUL, oversized UTF-8, opaque scripts, and nested hard denials before exec', async () => {
    const invalid = [
      'Write-Output "a\0b"',
      'é'.repeat(16_385),
      'Invoke-Expression $payload',
      'Start-Process $program',
      'vssadmin delete shadows /all',
      "pwsh.exe -EncodedCommand 'dmFsaWQ='",
    ];

    for (const script of invalid) {
      const run = harness();
      await assert.rejects(shellCommand.run({ script, reason: 'test' }, run.context));
      assert.equal(run.requests.length, 0, script.slice(0, 80));
    }
  });

  it('does not reject a denied word that is only data', async () => {
    const run = harness();
    const output = await shellCommand.run(
      { script: "Write-Output 'vssadmin'; # netsh", reason: 'show text' },
      run.context,
    );
    assert.equal(output.ok, true);
    assert.equal(run.requests.length, 1);
  });

  it('is exposed only by a supported environment tool set', () => {
    assert.equal(DEFAULT_TOOLS.some((tool) => tool.spec.name === 'shell_command'), false);
    assert.equal(toolsForEnvironment(supported).some((tool) => tool.spec.name === 'shell_command'), true);
    assert.equal(
      toolsForEnvironment({ dialect: null, reason: 'missing PowerShell' }).some(
        (tool) => tool.spec.name === 'shell_command',
      ),
      false,
    );
    assert.equal(subagentTools(null).some((tool) => tool.spec.name === 'shell_command'), false);
    assert.equal(subagentTools(dialect).some((tool) => tool.spec.name === 'shell_command'), true);
  });

  it('uses the same resolved dialect for loop registration and tool execution', async () => {
    const requests: ExecRequest[] = [];
    const container = {
      name: 'loop-test',
      workdir: '/project',
      capabilities: {},
      async exec(request: ExecRequest): Promise<ExecResult> {
        requests.push(request);
        return result();
      },
    } as unknown as Parameters<typeof runLoop>[1]['container'];
    const bus = new EventBus();
    let turn = 0;
    const provider: ModelProvider = {
      info: { id: 'test', endpoint: 'test://', contextWindow: undefined },
      async *stream(request): AsyncGenerator<CompletionEvent> {
        if (turn++ === 0) {
          assert.equal(request.tools.some((tool) => tool.name === 'shell_command'), true);
          yield {
            kind: 'tool',
            call: {
              id: 'shell-1',
              name: 'shell_command',
              arguments: JSON.stringify({ script: 'Get-Date', reason: 'integration test' }),
            },
          };
          yield { kind: 'done', reason: 'tool_calls', usage: { promptTokens: 1, completionTokens: 1 } };
          return;
        }
        yield { kind: 'text', delta: 'done' };
        yield { kind: 'done', reason: 'stop', usage: { promptTokens: 1, completionTokens: 1 } };
      },
      async probe() { return { ok: true, detail: 'test' }; },
      async list() { return []; },
    };

    const loop = await runLoop([{ role: 'user', content: 'run it' }], {
      provider,
      container,
      questions: new QuestionBroker(bus, 50),
      bus,
      shellDialect: dialect,
    });

    assert.equal(loop.text, 'done');
    assert.deepEqual(requests[0]?.argv, dialect.argv('Get-Date'));
  });
});
