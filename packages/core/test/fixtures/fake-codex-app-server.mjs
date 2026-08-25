import { createInterface } from 'node:readline';

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
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        data: [{
          model: 'codex-default',
          displayName: 'Codex default',
          inputModalities: ['text'],
          supportedReasoningEfforts: [],
        }],
      },
    });
    return;
  }
  send({ jsonrpc: '2.0', id: request.id, result: {} });
});
