import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { PortableBackend } from '@plif/sandbox';

import { PlifError } from '../src/errors.js';
import { Engine } from '../src/container/engine.js';
import type { Container } from '../src/container/container.js';
import { isJsonLossless, renderToolsSdk, runCodeMode, runLoop } from '../src/index.js';
import { EventBus } from '../src/events/bus.js';
import type { CompletionEvent, ModelProvider } from '../src/model/provider.js';
import { DispatchScheduler } from '../src/harness/code-mode/scheduler.js';
import { decodeInboundFrame } from '../src/harness/code-mode/protocol.js';
import type { Tool, ToolContext } from '../src/harness/tools.js';

const roots: string[] = [];
const engines: Engine[] = [];

after(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.shutdown()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function startContainer(name: string): Promise<Container> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-code-mode-'));
  roots.push(root);
  const engine = new Engine({ root, backend: new PortableBackend() });
  engines.push(engine);
  await engine.start();
  const image = await engine.ensureBaseImage();
  return await engine.run({ image: image.reference, mounts: [], name });
}

const echo: Tool = {
  parallelSafe: true,
  spec: {
    name: 'echo',
    description: 'Return the text it was given.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: 'What to echo.' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
  run: async (input) => ({ output: `echo:${String(input['text'])}`, ok: true }),
};

const broken: Tool = {
  spec: {
    name: 'broken',
    description: 'Always fails.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  run: async () => ({ output: 'this tool is broken', ok: false }),
};

const registry = new Map<string, Tool>([
  ['echo', echo],
  ['broken', broken],
]);

const call = async (
  name: string,
  args: Record<string, unknown>,
): Promise<{ output: string; ok: boolean }> => {
  const tool = registry.get(name);
  if (!tool) return { output: `Error: no tool named "${name}"`, ok: false };
  return await tool.run(args, {} as ToolContext);
};

describe('Code Mode fails closed without a process boundary', () => {
  it('refuses to run a program when there is no container to run it in', async () => {
    await assert.rejects(
      runCodeMode({
        source: 'return 42;',
        tools: new Map(),
        call: async () => ({ output: '', ok: true }),
      }),
      (error: unknown) => {
        assert.ok(error instanceof PlifError);
        assert.equal(error.code, 'POLICY_DENIED');
        assert.match(error.message, /process-isolated runtime/);
        assert.match(error.hint ?? '', /run_script/);
        return true;
      },
    );
  });
});

describe('the generated SDK', () => {
  it('is byte-identical for the same tool set, whatever order it arrives in', () => {
    const forward = renderToolsSdk([echo.spec, broken.spec]);
    const reversed = renderToolsSdk([broken.spec, echo.spec]);
    assert.equal(forward, reversed);
    assert.ok(forward.indexOf('broken:') < forward.indexOf('echo:'));
  });

  it('projects required and optional arguments differently', () => {
    const rendered = renderToolsSdk([
      {
        name: 'search',
        description: 'Search files.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
            limit: { type: 'integer' },
            mode: { enum: ['files', 'content'] },
          },
          required: ['pattern'],
          additionalProperties: false,
        },
      },
    ]);
    assert.match(rendered, /pattern: string;/);
    assert.match(rendered, /limit\?: number;/);
    assert.match(rendered, /mode\?: "files" \| "content";/);
  });

  it('never declares run_code to a program that is already inside one', () => {
    const rendered = renderToolsSdk([
      echo.spec,
      { name: 'run_code', description: 'Run a program.', parameters: { type: 'object' } },
    ]);
    assert.doesNotMatch(rendered, /^ {2}run_code:/m);
  });
});

describe('the runtime wire treats the program as a hostile peer', () => {
  it('rejects values that would not survive a JSON round trip', () => {
    assert.equal(isJsonLossless({ a: 1, b: [true, null, 'x'] }), true);
    assert.equal(isJsonLossless({ a: undefined }), false);
    assert.equal(isJsonLossless({ a: Number.NaN }), false);
    assert.equal(isJsonLossless({ a: () => 1 }), false);
    assert.equal(isJsonLossless(new Date()), false);
  });

  it('rebuilds call arguments so a forged __proto__ stays an ordinary key', () => {
    const frame = decodeInboundFrame(
      JSON.stringify({ t: 'call', id: 1, name: 'echo', args: { __proto__: { polluted: true } } }),
    );
    assert.ok(frame && frame.t === 'call');
    assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
    assert.equal(Object.getPrototypeOf(frame.args), null);
  });

  it('refuses frames that are malformed rather than guessing what they meant', () => {
    assert.equal(decodeInboundFrame('not json'), undefined);
    assert.equal(decodeInboundFrame(JSON.stringify({ t: 'call', id: -1, name: 'echo' })), undefined);
    assert.equal(decodeInboundFrame(JSON.stringify({ t: 'call', id: 1, args: {} })), undefined);
    assert.equal(decodeInboundFrame(JSON.stringify({ t: 'nope' })), undefined);
  });
});

describe('the nested scheduler', () => {
  it('overlaps parallel-safe calls and commits them in submission order', async () => {
    const commits: string[] = [];
    let live = 0;
    let peak = 0;
    const scheduler = new DispatchScheduler({
      maxParallel: 4,
      maxCalls: 16,
      callIdPrefix: 'call-1',
      isParallelSafe: () => true,
      onCommit: (record) => commits.push(record.name),
      dispatch: async (name) => {
        live += 1;
        peak = Math.max(peak, live);
        // The first call is the slowest, so a scheduler that committed on
        // completion rather than on submission would record it last.
        await new Promise((resolve) => setTimeout(resolve, name === 'a' ? 40 : 5));
        live -= 1;
        return { ok: true, output: name };
      },
    });

    await Promise.all([
      scheduler.submit('a', {}),
      scheduler.submit('b', {}),
      scheduler.submit('c', {}),
    ]);
    await scheduler.close();

    assert.ok(peak > 1, 'parallel-safe calls should overlap');
    assert.deepEqual(commits, ['a', 'b', 'c']);
  });

  it('runs a call that is not parallel-safe alone', async () => {
    let live = 0;
    let peak = 0;
    const scheduler = new DispatchScheduler({
      maxParallel: 4,
      maxCalls: 16,
      callIdPrefix: 'call-2',
      isParallelSafe: (name) => name !== 'write',
      onCommit: () => undefined,
      dispatch: async () => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((resolve) => setTimeout(resolve, 10));
        live -= 1;
        return { ok: true, output: '' };
      },
    });

    await Promise.all([
      scheduler.submit('write', {}),
      scheduler.submit('write', {}),
      scheduler.submit('write', {}),
    ]);
    await scheduler.close();
    assert.equal(peak, 1);
  });

  it('refuses a program that asks for more calls than the run allows', async () => {
    const scheduler = new DispatchScheduler({
      maxParallel: 2,
      maxCalls: 1,
      callIdPrefix: 'call-3',
      isParallelSafe: () => true,
      onCommit: () => undefined,
      dispatch: async () => ({ ok: true, output: '' }),
    });
    await scheduler.submit('echo', {});
    await assert.rejects(scheduler.submit('echo', {}), /budget of 1 tool calls/);
    await scheduler.close();
  });
});

describe('a program running in its own process', () => {
  it('calls tools, keeps their output out of the result, and returns a value', async () => {
    const container = await startContainer('code-mode-happy');
    const result = await runCodeMode({
      source: [
        'const [first, second] = await Promise.all([',
        '  tools.echo({ text: "one" }),',
        '  tools.echo({ text: "two" }),',
        ']);',
        'console.log("collected", 2);',
        'return { first: first.output, second: second.output };',
      ].join('\n'),
      tools: registry,
      call,
      container,
      callIdPrefix: 'call-happy',
    });

    assert.equal(result.ok, true, result.output);
    assert.equal(result.toolCallCount, 2);
    assert.match(result.output, /collected 2/);
    assert.match(result.output, /echo:one/);
    assert.deepEqual(
      result.dispatches.map((record) => record.name),
      ['echo', 'echo'],
    );
    assert.equal(result.dispatches[0]?.id, 'call-happy:code:1');
  });

  it('reports a thrown program as an exception, with what it logged before it threw', async () => {
    const container = await startContainer('code-mode-throw');
    const result = await runCodeMode({
      source: 'console.log("before");\nthrow new Error("deliberate");',
      tools: registry,
      call,
      container,
    });

    assert.equal(result.ok, false);
    assert.equal(result.failure?.kind, 'exception');
    assert.match(result.output, /deliberate/);
    assert.match(result.output, /before/);
  });

  it('turns a failed tool into a catchable error rather than a silent result', async () => {
    const container = await startContainer('code-mode-tool-failure');
    const result = await runCodeMode({
      source: [
        'try {',
        '  await tools.broken({});',
        '  return "unreachable";',
        '} catch (error) {',
        '  return { name: error.name, tool: error.toolName };',
        '}',
      ].join('\n'),
      tools: registry,
      call,
      container,
    });

    assert.equal(result.ok, true, result.output);
    assert.match(result.output, /ToolCallError/);
    assert.match(result.output, /broken/);
    assert.equal(result.dispatches[0]?.ok, false);
  });

  it('refuses a returned value larger than the run allows', async () => {
    const container = await startContainer('code-mode-output-limit');
    const result = await runCodeMode({
      source: 'return "x".repeat(5000);',
      tools: registry,
      call,
      container,
      limits: { outputBytes: 512 },
    });
    assert.equal(result.ok, false);
    assert.equal(result.failure?.kind, 'output-limit');
    assert.match(result.output, /write the rest to a file/);
  });

  it('reports a container that cannot spawn as unavailable rather than throwing', async () => {
    const container = await startContainer('code-mode-unavailable');
    await container.stop('test teardown');
    const result = await runCodeMode({
      source: 'return 1;',
      tools: registry,
      call,
      container,
    });
    assert.equal(result.ok, false);
    assert.equal(result.failure?.kind, 'unavailable');
  });

  it('strips TypeScript annotations instead of failing on them', async () => {
    const container = await startContainer('code-mode-typescript');
    const result = await runCodeMode({
      source: 'const label: string = "typed";\nreturn label;',
      tools: registry,
      call,
      container,
    });
    assert.equal(result.ok, true, result.output);
    assert.match(result.output, /typed/);
  });
});

describe('the presentation the loop puts on the wire', () => {
  const readTool: Tool = {
    parallelSafe: true,
    spec: {
      name: 'read_thing',
      description: 'Read a thing.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
    run: async () => ({ output: 'the thing', ok: true }),
  };

  function scriptedProvider(
    events: readonly CompletionEvent[][],
    seen: Parameters<ModelProvider['stream']>[0][],
  ): ModelProvider {
    let turn = 0;
    return {
      info: { id: 'code-mode-wire-test', endpoint: 'test', contextWindow: 100_000 },
      async *stream(request): AsyncGenerator<CompletionEvent> {
        seen.push(request);
        const scripted = events[Math.min(turn, events.length - 1)] ?? [];
        turn += 1;
        for (const event of scripted) yield event;
        yield { kind: 'done', reason: 'stop', usage: { promptTokens: 1, completionTokens: 1 } };
      },
      async probe() {
        return { ok: true, detail: 'ok' };
      },
      async list() {
        return [];
      },
    };
  }

  it('sends every schema in native mode and no run_code', async () => {
    const seen: Parameters<ModelProvider['stream']>[0][] = [];
    await runLoop([{ role: 'user', content: 'hi' }], {
      provider: scriptedProvider([[]], seen),
      container: {} as never,
      questions: {} as never,
      bus: new EventBus(),
      tools: [readTool],
      maxIterations: 1,
      runScript: false,
    });
    const names = seen[0]?.tools?.map((spec) => spec.name) ?? [];
    assert.deepEqual(names, ['read_thing']);
  });

  it('collapses the wire to run_code alone in code mode', async () => {
    const seen: Parameters<ModelProvider['stream']>[0][] = [];
    await runLoop([{ role: 'user', content: 'hi' }], {
      provider: scriptedProvider([[]], seen),
      container: {} as never,
      questions: {} as never,
      bus: new EventBus(),
      tools: [readTool],
      maxIterations: 1,
      toolMode: 'code',
    });
    assert.deepEqual(seen[0]?.tools?.map((spec) => spec.name), ['run_code']);
  });

  it('keeps both presentations available in both mode', async () => {
    const seen: Parameters<ModelProvider['stream']>[0][] = [];
    await runLoop([{ role: 'user', content: 'hi' }], {
      provider: scriptedProvider([[]], seen),
      container: {} as never,
      questions: {} as never,
      bus: new EventBus(),
      tools: [readTool],
      maxIterations: 1,
      runScript: false,
      toolMode: 'both',
    });
    const names = (seen[0]?.tools ?? []).map((spec) => spec.name);
    assert.deepEqual(names, ['read_thing', 'run_code']);
  });

  it('refuses a direct call to a collapsed tool without running it', async () => {
    const seen: Parameters<ModelProvider['stream']>[0][] = [];
    let ran = 0;
    const counted: Tool = { ...readTool, run: async () => { ran += 1; return { output: 'x', ok: true }; } };
    await runLoop([{ role: 'user', content: 'hi' }], {
      provider: scriptedProvider(
        [[{ kind: 'tool', call: { id: 'c1', name: 'read_thing', arguments: '{"id":"a"}' } }], []],
        seen,
      ),
      container: {} as never,
      questions: {} as never,
      bus: new EventBus(),
      tools: [counted],
      maxIterations: 2,
      toolMode: 'code',
    });

    assert.equal(ran, 0, 'a collapsed tool must not run');
    const result = seen.at(-1)?.messages.find((message) => message.role === 'tool');
    assert.match(result?.content ?? '', /only `run_code` can be called directly/);
    assert.match(result?.content ?? '', /read_thing/);
  });
});
