import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { COMMANDS } from '../src/commands.js';
import type { CommandContext } from '../src/commands.js';
import { entry } from '../src/session.js';
import type { BrowserTab, TimelineEntry } from '../src/session.js';

const mcp = COMMANDS.find((command) => command.name === 'mcp');

interface Recorder {
  readonly context: CommandContext;
  readonly opened: BrowserTab[];
  readonly logins: string[];
}

function recorder(names: readonly string[] = ['context7', 'github']): Recorder {
  const opened: BrowserTab[] = [];
  const logins: string[] = [];
  const context = {
    openBrowser: (tab: BrowserTab) => {
      opened.push(tab);
    },
    mcpNames: names,
    loginMcp: async (server: string): Promise<TimelineEntry> => {
      logins.push(server);
      return entry('notice', `${server} authenticated`, { tone: 'accent' });
    },
  } as unknown as CommandContext;
  return { context, opened, logins };
}

describe('/mcp', () => {
  it('opens the browser when given nothing', async () => {
    const { context, opened, logins } = recorder();
    const result = await mcp!.run([], context);

    assert.deepEqual(opened, ['mcp']);
    assert.deepEqual(logins, []);
    assert.deepEqual(result.entries, []);
  });

  it('logs in with the server named first', async () => {
    const { context, opened, logins } = recorder();
    const result = await mcp!.run(['context7', 'login'], context);

    assert.deepEqual(logins, ['context7']);
    assert.deepEqual(opened, []);
    assert.match(result.entries[0]?.title ?? '', /context7 authenticated/);
  });

  it('logs in with the verb first, the way every other CLI reads', async () => {
    const { context, logins } = recorder();
    await mcp!.run(['login', 'context7'], context);

    assert.deepEqual(logins, ['context7']);
  });

  it('is not case sensitive about the verb', async () => {
    const { context, logins } = recorder();
    await mcp!.run(['LOGIN', 'github'], context);

    assert.deepEqual(logins, ['github']);
  });

  it('names the servers it knows when no server was given', async () => {
    const { context, logins, opened } = recorder();
    const result = await mcp!.run(['login'], context);

    assert.deepEqual(logins, []);
    assert.deepEqual(opened, [], 'a half-typed command must not open the browser instead');
    assert.match(result.entries[0]?.detail ?? result.entries[0]?.subtitle ?? '', /context7, github/);
  });

  it('says so when nothing is configured to log in to', async () => {
    const { context } = recorder([]);
    const result = await mcp!.run(['login'], context);

    assert.match(result.entries[0]?.subtitle ?? '', /no MCP servers/i);
  });

  it('does not silently browse when the argument makes no sense', async () => {
    const { context, opened, logins } = recorder();
    const result = await mcp!.run(['contect7', 'logn'], context);

    assert.deepEqual(opened, []);
    assert.deepEqual(logins, []);
    assert.match(result.entries[0]?.title ?? '', /does not know/);
  });
});
