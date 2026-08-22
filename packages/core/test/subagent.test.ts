import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EventBus } from '../src/events/bus.js';
import { subagentTool } from '../src/harness/subagent.js';
import type { Tool, ToolContext } from '../src/harness/tools.js';
import type { CompletionEvent, CompletionRequest, ModelProvider } from '../src/model/provider.js';
import { DEFAULT_CAPABILITIES } from '../src/types.js';

function provider(id: string, answer = 'delegated result'): ModelProvider {
  return {
    info: { id, endpoint: 'https://provider.example.test/v1', contextWindow: 16_384 },
    async *stream(): AsyncGenerator<CompletionEvent> {
      yield { kind: 'text', delta: answer };
      yield {
        kind: 'done',
        reason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1 },
      };
    },
    async probe() { return { ok: true, detail: 'ok' }; },
    async list() { return []; },
  };
}

describe('subagent credential routing', () => {
  it('resolves the selected provider key through the encrypted-broker seam', async () => {
    let requestedProvider = '';
    let resolvedKey = '';
    let authorized = '';
    let childContextBudget = 0;
    const tool = subagentTool({
      provider: provider('parent'),
      isolation: 'test',
      stored: {
        model: 'private/parent-model',
        provider: {
          private: {
            options: { baseURL: 'https://private.example.test/v1', needKey: true },
            models: { 'vision-model': { modalities: ['text', 'image'] } },
          },
        },
      },
      resolveCredential: async (providerId) => {
        requestedProvider = providerId;
        return 'dpapi-key';
      },
      createProvider: (config) => {
        resolvedKey = config.apiKey;
        return provider(config.model);
      },
      maxIterations: 2,
    });

    const bus = new EventBus();
    bus.on('subagent.usage', (event) => { childContextBudget = event.budget; });
    const context = {
      container: {
        name: 'test-container',
        workdir: '/workspace',
        capabilities: DEFAULT_CAPABILITIES,
        authorizeModel: async (model: string) => { authorized = model; },
      },
      questions: {},
      signal: undefined,
      bus,
      callId: 'credential-test',
      workspace: 'C:/workspace',
    } as unknown as ToolContext;

    const result = await tool.run({
      title: 'Inspect an image',
      task: 'Return the relevant observation.',
      model: 'private/vision-model',
    }, context);

    assert.equal(result.ok, true);
    assert.equal(requestedProvider, 'private');
    assert.equal(resolvedKey, 'dpapi-key');
    assert.equal(authorized, 'private/vision-model');
    assert.equal(childContextBudget, 16_384);
    assert.match(result.output, /delegated result/);
  });

  it('propagates the PLIF skill gate and Galileu tool to subagents', async () => {
    let request: CompletionRequest | undefined;
    const childProvider: ModelProvider = {
      ...provider('parent'),
      async *stream(input) {
        request = input;
        yield { kind: 'text', delta: 'delegated result' };
        yield {
          kind: 'done',
          reason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1 },
        };
      },
    };
    const skill: Tool = {
      spec: {
        name: 'skill',
        description: 'Load a skill.',
        parameters: {},
      },
      async run() {
        return { output: '# Skill: galileu', ok: true };
      },
    };
    const tool = subagentTool({
      provider: childProvider,
      isolation: 'test',
      stored: { model: 'parent', effort: 'plif' },
      skillCatalogue: '- galileu: Socratic decision review',
      extraTools: [skill],
      maxIterations: 2,
    });

    const context = {
      container: {
        name: 'test-container',
        workdir: '/workspace',
        capabilities: DEFAULT_CAPABILITIES,
        authorizeModel: async () => undefined,
      },
      questions: {},
      signal: undefined,
      bus: new EventBus(),
      callId: 'plif-skill-test',
      workspace: 'C:/workspace',
    } as unknown as ToolContext;

    const result = await tool.run({ title: 'PLIF child', task: 'Return the result.' }, context);

    assert.equal(result.ok, true);
    assert.ok(request);
    const systemPrompt = request.messages[0]?.content;
    assert.equal(typeof systemPrompt, 'string');
    assert.match(systemPrompt as string, /## Mandatory PLIF skill/);
    assert.match(systemPrompt as string, /^- galileu: Socratic decision review$/m);
    assert.doesNotMatch(systemPrompt as string, /session is misconfigured/i);
    assert.ok(request.tools?.some((candidate) => candidate.name === 'skill'));
  });
});
