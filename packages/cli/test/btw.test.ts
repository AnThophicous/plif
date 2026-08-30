import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findCommand, parseBtwAction } from '../src/commands.js';
import { buildBtwMessages, redactBtwSecrets } from '../src/commands/btw.js';
import type { CommandContext } from '../src/commands.js';
import type { Message } from '@plif/core';

describe('/btw side-channel request', () => {
  it('builds a fresh read-only request from safe message content only', () => {
    const conversation: Message[] = [
      {
        role: 'user',
        content: 'API_KEY=super-secret and keep this attachment out',
        attachments: [{ kind: 'text', name: 'pasted', text: 'PRIVATE=also-secret' }],
      },
      {
        role: 'assistant',
        content: 'The main agent is still working.',
        reasoning: 'internal reasoning must not cross the boundary',
      },
      { role: 'tool', content: 'tool output must not cross the boundary' },
    ];
    const messages = buildBtwMessages('Why is API_KEY=question-secret unavailable?', conversation);
    const wire = JSON.stringify(messages);

    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.role, 'system');
    assert.match(messages[0]?.content ?? '', /read-only/);
    assert.doesNotMatch(wire, /super-secret|also-secret|question-secret/);
    assert.doesNotMatch(wire, /internal reasoning|tool output/);
    assert.doesNotMatch(wire, /attachments|toolCalls/);
    assert.match(messages[1]?.content ?? '', /Why is API_KEY/);
    assert.match(redactBtwSecrets('Bearer abcdefghijklmnop'), /redacted-secret/);
  });

  it('dispatches while the primary turn remains busy and produces no main transcript entry', async () => {
    let primaryBusy = true;
    const mainTranscript: string[] = [];
    let received = '';
    const result = await findCommand('btw')!.run(['why', 'now?'], {
      runBtw: async (question) => {
        assert.equal(primaryBusy, true);
        received = question;
        await new Promise<void>((resolve) => setTimeout(resolve, 2));
        primaryBusy = true;
      },
      notify: (item) => mainTranscript.push(item.title),
    } as unknown as CommandContext);

    assert.equal(received, 'why now?');
    assert.equal(primaryBusy, true);
    assert.deepEqual(result.entries, []);
    assert.deepEqual(mainTranscript, []);
  });

  it('has explicit open/cancel parsing for the independent panel', async () => {
    assert.deepEqual(parseBtwAction([]), { action: 'open' });
    assert.deepEqual(parseBtwAction(['cancel']), { action: 'cancel' });
    assert.deepEqual(parseBtwAction(['what', 'is', 'this']), { action: 'ask', question: 'what is this' });

    let opened = false;
    const openResult = await findCommand('btw')!.run([], {
      openBtw: () => { opened = true; },
    } as unknown as CommandContext);
    assert.equal(opened, true);
    assert.deepEqual(openResult.entries, []);

    let cancelled = false;
    await findCommand('btw')!.run(['cancel'], {
      cancelBtw: () => { cancelled = true; },
    } as unknown as CommandContext);
    assert.equal(cancelled, true);
  });
});
