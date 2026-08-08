import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EventBus, McpRegistry } from '@plif/core';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.join(here, 'mcp-demo-server.mjs');

const bus = new EventBus();
bus.on('mcp.connected', (e) =>
  console.log(`conectado: ${e.server} (${e.transport}) -> ${e.tools.join(', ')}`),
);
bus.on('log', (e) => console.log(`[${e.level}] ${e.message}: ${JSON.stringify(e.detail)}`));

const registry = await McpRegistry.connect(
  {
    demo: { command: process.execPath, args: [server] },
    quebrado: { command: process.execPath, args: [path.join(here, 'nao-existe.mjs')] },
    desligado: { command: 'never-runs', enabled: false },
  },
  bus,
);

console.log('\nservidores:');
for (const status of registry.statuses()) {
  console.log(`  ${status.name.padEnd(12)} conectado=${String(status.connected).padEnd(6)} ${status.detail}`);
}

const tools = registry.tools();
console.log('\nferramentas expostas:', tools.map((t) => t.spec.name).join(', '));

const add = tools.find((t) => t.spec.name === 'mcp__demo__add');
console.log(`\nmcp__demo__add(17,25) -> ${JSON.stringify(await add.run({ a: 17, b: 25 }, {}))}`);

const boom = tools.find((t) => t.spec.name === 'mcp__demo__boom');
console.log(`mcp__demo__boom()      -> ${JSON.stringify(await boom.run({}, {}))}`);

console.log('\ncatalogo para o prompt:');
console.log(registry.catalogue());

await registry.close();
process.exit(0);
