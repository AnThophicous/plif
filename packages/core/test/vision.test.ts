import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { QuestionBroker } from '../src/harness/ask.js';
import type { Question } from '../src/harness/ask.js';
import type { Tool, ToolContext } from '../src/harness/tools.js';
import { visionTools } from '../src/harness/vision.js';
import { resolveConfig, visionCandidates } from '../src/model/config.js';
import type { ModelProvider } from '../src/model/provider.js';
import type { StoredConfig } from '../src/model/config.js';

const provider: ModelProvider = {
  info: { id: 'test/main', endpoint: 'https://main.example.test/v1', contextWindow: undefined },
  async *stream() {
    yield { kind: 'done', reason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } };
  },
  async probe() {
    return { ok: true, detail: 'test' };
  },
  async list() {
    return [];
  },
};

const visionProvider = {
  custom: {
    sdk: 'openai' as const,
    options: { baseURL: 'https://vision.example.test/v1' },
    models: {
      vision: {
        name: 'Vision model',
        modalities: ['text', 'image'] as const,
        cost: 'paid' as const,
      },
    },
  },
};

function context(
  questions: QuestionBroker,
  attachments = [{
    kind: 'image' as const,
    mediaType: 'image/png',
    data: 'AQI=',
    name: 'pasted.png',
  }],
): ToolContext {
  return {
    container: {} as ToolContext['container'],
    questions,
    signal: undefined,
    attachments,
  };
}

function childTool(onRun: (input: Record<string, unknown>) => void): Tool {
  return {
    spec: {
      name: 'subagent',
      description: 'test child',
      parameters: { type: 'object', properties: {} },
    },
    async run(input) {
      onRun(input);
      return { output: 'vision result', ok: true };
    },
  };
}

function inspectTool(tools: readonly Tool[]): Tool {
  const tool = tools.find((candidate) => candidate.spec.name === 'inspect_image');
  assert.ok(tool, 'vision tools should include inspect_image');
  return tool;
}

describe('vision endpoint routing', () => {
  it('uses the effective env endpoint and the resolver default', () => {
    const config: StoredConfig = { provider: visionProvider };
    const env = { PLIF_BASE_URL: 'https://env.example.test/v1' };
    const fromEnv = visionCandidates(config, { env });
    assert.equal(fromEnv.length, 1);
    assert.equal(
      fromEnv[0]?.baseURL,
      resolveConfig(config, { model: 'custom/vision', env }).baseURL,
    );
    assert.equal(fromEnv[0]?.baseURL, 'https://env.example.test/v1');

    const withoutEnv = visionCandidates({
      provider: {
        custom: {
          models: { vision: { modalities: ['text', 'image'] as const } },
        },
      },
    }, { env: {} });
    assert.equal(withoutEnv[0]?.baseURL, 'https://api.openai.com/v1');
  });

  it('follows resolveConfig when custom provider names collide', () => {
    const config: StoredConfig = {
      providers: {
        bridge: {
          options: { baseURL: 'https://old.example.test/v1' },
          models: { vision: { name: 'old', modalities: ['text', 'image'] as const } },
        },
      },
      provider: {
        bridge: {
          options: { baseURL: 'https://winner.example.test/v1' },
          models: { vision: { name: 'winner', modalities: ['text', 'image'] as const } },
        },
      },
    };
    const candidate = visionCandidates(config, { env: {} })[0];
    assert.ok(candidate);
    assert.equal(candidate.label, 'winner');
    assert.equal(
      candidate.baseURL,
      resolveConfig(config, { model: 'bridge/vision', env: {} }).baseURL,
    );
    assert.equal(candidate.baseURL, 'https://winner.example.test/v1');

    const builtInCollision: StoredConfig = {
      provider: {
        openai: {
          options: { baseURL: 'https://custom-openai.example.test/v1' },
          models: { vision: { modalities: ['text', 'image'] as const } },
        },
      },
    };
    const builtInCandidate = visionCandidates(builtInCollision, { env: {} })[0];
    assert.ok(builtInCandidate);
    assert.equal(
      builtInCandidate.baseURL,
      resolveConfig(builtInCollision, { model: 'openai/vision', env: {} }).baseURL,
    );
    assert.equal(builtInCandidate.baseURL, 'https://custom-openai.example.test/v1');
  });

  it('recommends the lowest explicitly known vision cost without guessing unknown prices', () => {
    const candidates = visionCandidates({
      provider: {
        custom: {
          options: { baseURL: 'https://vision.example.test/v1' },
          models: {
            unknown: { modalities: ['text', 'image'] as const },
            paid: {
              modalities: ['text', 'image'] as const,
              pricing: { inputPerMillion: 0.4, outputPerMillion: 0.8 },
            },
            free: { modalities: ['text', 'image'] as const, cost: 'free' as const },
          },
        },
      },
    });
    assert.deepEqual(candidates.map((candidate) => candidate.model), ['free', 'paid', 'unknown']);
    assert.equal(candidates[0]?.recommended, true);
    assert.equal(candidates[1]?.recommended, false);
    assert.equal(candidates[2]?.recommended, false);
  });
});

describe('vision consent', () => {
  it('asks for consent before an auto-approved first use and discloses the route', async () => {
    const config: StoredConfig = { autoApprove: true, provider: visionProvider };
    const asked: Question[] = [];
    let childCalls = 0;
    const questions = {
      ask: async (question: Question) => {
        asked.push(question);
        return 'cancel';
      },
    } as unknown as QuestionBroker;
    const tools = visionTools(
      { provider, isolation: 'test', stored: config },
      {
        loadConfig: async () => config,
        createChild: () => childTool(() => { childCalls += 1; }),
      },
    );

    const result = await inspectTool(tools).run({ question: 'read the image' }, context(questions));
    assert.equal(result.ok, false);
    assert.equal(result.output, 'Vision delegation cancelled.');
    assert.equal(childCalls, 0);
    assert.equal(asked.length, 1);
    const disclosure = asked[0]?.context ?? '';
    assert.match(disclosure, /Model: vision/);
    assert.match(disclosure, /Provider: custom/);
    assert.match(disclosure, /Endpoint: https:\/\/vision\.example\.test\/v1/);
    assert.match(disclosure, /Cost: paid/);
    assert.match(disclosure, /third-party provider/);
    assert.deepEqual(
      asked[0]?.options?.map((option) => typeof option === 'string' ? option : option.value),
      ['always', 'once', 'cancel'],
    );
  });

  it('fails closed when a responder gives an answer outside the consent choices', async () => {
    const config: StoredConfig = { autoApprove: true, provider: visionProvider };
    let childCalls = 0;
    const questions = {
      ask: async () => 'There is no human available in this non-interactive run.',
    } as unknown as QuestionBroker;
    const tools = visionTools(
      { provider, isolation: 'test', stored: config },
      {
        loadConfig: async () => config,
        createChild: () => childTool(() => { childCalls += 1; }),
      },
    );

    const result = await inspectTool(tools).run({ question: 'read the image' }, context(questions));
    assert.equal(result.ok, false);
    assert.equal(childCalls, 0);
  });

  it('redacts endpoint credentials from the consent disclosure', async () => {
    const config: StoredConfig = {
      autoApprove: true,
      provider: {
        custom: {
          options: {
            baseURL: 'https://user:secret@vision.example.test/v1?api_key=secret&key=k&access_key=a&subscription-key=s&region=us',
          },
          models: { vision: { modalities: ['text', 'image'] as const, cost: 'paid' as const } },
        },
      },
    };
    let disclosure = '';
    const questions = {
      ask: async (question: Question) => {
        disclosure = question.context ?? '';
        return 'cancel';
      },
    } as unknown as QuestionBroker;
    const tools = visionTools(
      { provider, isolation: 'test', stored: config },
      { loadConfig: async () => config, createChild: () => childTool(() => undefined) },
    );

    await inspectTool(tools).run({ question: 'read the image' }, context(questions));
    assert.match(disclosure, /Endpoint: https:\/\/vision\.example\.test\/v1\?region=us/);
    assert.doesNotMatch(disclosure, /user|secret|api_key|access_key|subscription-key|[?&]key=/);
  });

  it('persists an explicit remember choice and passes the saved route to the child', async () => {
    const config: StoredConfig = { autoApprove: true, provider: visionProvider };
    let saved: StoredConfig | undefined;
    let childInput: Record<string, unknown> | undefined;
    const questions = {
      ask: async () => 'always',
    } as unknown as QuestionBroker;
    const tools = visionTools(
      { provider, isolation: 'test', stored: config },
      {
        loadConfig: async () => config,
        saveConfig: async (next) => { saved = next; },
        createChild: (stored) => childTool((input) => {
          childInput = { ...input, savedModel: stored.visionModel };
        }),
      },
    );

    const result = await inspectTool(tools).run({ question: 'read the image' }, context(questions));
    assert.equal(result.ok, true);
    assert.equal(saved?.visionModel, 'custom/vision');
    assert.equal(childInput?.['model'], 'custom/vision');
    assert.equal(childInput?.['savedModel'], 'custom/vision');
  });

  it('does not ask again when a vision model is already saved', async () => {
    const config: StoredConfig = { autoApprove: true, provider: visionProvider, visionModel: 'custom/vision' };
    let questionsAsked = 0;
    let childInput: Record<string, unknown> | undefined;
    const questions = {
      ask: async () => {
        questionsAsked += 1;
        return 'cancel';
      },
    } as unknown as QuestionBroker;
    const tools = visionTools(
      { provider, isolation: 'test', stored: config },
      {
        loadConfig: async () => config,
        createChild: () => childTool((input) => { childInput = input; }),
      },
    );

    const result = await inspectTool(tools).run({ question: 'read the image' }, context(questions));
    assert.equal(result.ok, true);
    assert.equal(questionsAsked, 0);
    assert.equal(childInput?.['model'], 'custom/vision');
  });
});
