import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';

const input = createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

input.on('line', (line) => {
  if (!line.trim()) return;
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    if (request.params?.capabilities?.experimentalApi !== true) {
      send({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32600, message: 'experimentalApi capability required' },
      });
      return;
    }
    send({ jsonrpc: '2.0', id: request.id, result: { userAgent: 'fake-codex' } });
    return;
  }
  if (request.method === 'model/list') {
    const models = process.env.PLIF_CODEX_MODELS === 'multiple'
      ? [
          {
            model: 'gpt-5.6-luna',
            displayName: 'GPT-5.6 Luna',
            inputModalities: ['text', 'image'],
            supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
          },
          {
            model: 'gpt-5.4-mini',
            displayName: 'GPT-5.4 Mini',
            inputModalities: ['text'],
            supportedReasoningEfforts: [],
          },
        ]
      : [{
          model: 'codex-default',
          displayName: 'Codex default',
          inputModalities: ['text'],
          supportedReasoningEfforts: [],
        }];
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        data: models,
      },
    });
    return;
  }
  if (request.method === 'account/read') {
    const accountId = process.env.PLIF_CODEX_ACCOUNT_ID;
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: accountId ? { account: { id: accountId, type: 'chatgpt' } } : {},
    });
    return;
  }
  if (request.method === 'thread/start') {
    const capturePath = process.env.PLIF_CODEX_THREAD_CAPTURE;
    if (capturePath) writeFileSync(capturePath, JSON.stringify(request), 'utf8');
    send({ jsonrpc: '2.0', id: request.id, result: { thread: { id: 'thread-1' } } });
    return;
  }
  if (request.method === 'thread/resume') {
    const capturePath = process.env.PLIF_CODEX_RESUME_CAPTURE;
    if (capturePath) writeFileSync(capturePath, JSON.stringify(request), 'utf8');
    if (process.env.PLIF_CODEX_RESUME_FAIL === '1') {
      send({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32004, message: 'thread expired' },
      });
      return;
    }
    send({ jsonrpc: '2.0', id: request.id, result: { thread: { id: request.params.threadId } } });
    return;
  }
  if (request.method === 'turn/start') {
    const capturePath = process.env.PLIF_CODEX_CAPTURE;
    if (capturePath) writeFileSync(capturePath, JSON.stringify(request), 'utf8');
    send({ jsonrpc: '2.0', id: request.id, result: { turn: { id: 'turn-1' } } });
    if (process.env.PLIF_CODEX_ACTIVITY === '1') {
      send({
        jsonrpc: '2.0',
        method: 'item/started',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          item: { id: 'cmd-1', type: 'commandExecution', command: 'npm test', cwd: '/workspace' },
        },
      });
      send({
        jsonrpc: '2.0',
        method: 'item/commandExecution/outputDelta',
        params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'cmd-1', delta: 'passed\n' },
      });
      send({
        jsonrpc: '2.0',
        method: 'item/completed',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          item: { id: 'cmd-1', type: 'commandExecution', command: 'npm test', status: 'completed', exitCode: 0 },
        },
      });
      send({
        jsonrpc: '2.0',
        method: 'item/reasoning/summaryTextDelta',
        params: { threadId: 'thread-1', turnId: 'turn-1', delta: 'checking' },
      });
    }
    send({
      jsonrpc: '2.0',
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', delta: 'ok' },
    });
    send({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn-1', turn: { id: 'turn-1', status: 'completed' } },
    });
    return;
  }
  send({ jsonrpc: '2.0', id: request.id, result: {} });
});
