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

  it('propagates the PLIF skill gate and required skills to subagents', async () => {
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
        return { output: '# Skill: plief-galileu', ok: true };
      },
    };
    const tool = subagentTool({
      provider: childProvider,
      isolation: 'test',
      stored: { model: 'parent', effort: 'plif' },
      skillCatalogue: [
        '- anti-ai-slop: Clean, human-readable output without generated-sounding prose',
        '- plief-galileu: Socratic decision review',
        '- plief-argus: Principal security engineering',
      ].join('\n'),
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
     assert.match(systemPrompt as string, /## Mandatory PLIF skills and review checkpoint/);
     assert.match(systemPrompt as string, /^- plief-galileu: Socratic decision review$/m);
     assert.match(systemPrompt as string, /^- plief-argus: Principal security engineering$/m);
    assert.doesNotMatch(systemPrompt as string, /session is misconfigured/i);
    assert.ok(request.tools?.some((candidate) => candidate.name === 'skill'));
  });

  it('requires explicit intent when named-agent auto-use is disabled and preserves the role prompt', async () => {
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
    const tool = subagentTool({
      provider: childProvider,
      isolation: 'test',
      stored: { model: 'opencode/deepseek-v4-flash-free' },
      agents: {
        "CEO - Pli'ef": {
          model: 'opencode/deepseek-v4-flash-free',
          description: 'Executive project orchestrator',
          instructions: '# CEO role\nOwn the project result and verify the delivery.',
        },
      },
      agentAutoLaunch: false,
      createProvider: () => childProvider,
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
      callId: 'agent-policy-test',
      workspace: 'C:/workspace',
    } as unknown as ToolContext;

    const blocked = await tool.run({
      title: 'Choose an executive',
      task: 'Return the result.',
      model: "CEO - Pli'ef",
    }, context);
    assert.equal(blocked.ok, false);
    assert.match(blocked.output, /automatic launch.*disabled/i);

    const explicit = await tool.run({
      title: 'Choose an executive',
      task: 'Return the result.',
      model: "CEO - Pli'ef",
      explicit: true,
    }, context);
    assert.equal(explicit.ok, true);
    const systemPrompt = request?.messages[0]?.content;
    assert.equal(typeof systemPrompt, 'string');
    assert.match(systemPrompt as string, /# Active profile: CEO - Pli'ef/);
    assert.match(systemPrompt as string, /# CEO role/);
  });
});
