import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BrowserSession } from '../src/browser/session.js';
import type { BrowserHost } from '../src/browser/session.js';

/**
 * A host that starts a "browser" which never publishes a CDP endpoint.
 *
 * That is the failure the guard is about: Chromium is running by the time the
 * endpoint is expected, so an open that gives up has a process to clean up.
 */
function silentHost(): { host: BrowserHost; started: () => number; closed: () => number } {
  let started = 0;
  let closed = 0;
  return {
    host: {
      async startTerminal() {
        started += 1;
        return { terminalId: String(started), ownerId: 'primary' };
      },
      async readTerminal() {
        return [{ stream: 'stdout', chunk: 'nothing that looks like an endpoint\n' }];
      },
      async closeTerminal() {
        closed += 1;
        return {};
      },
    },
    started: () => started,
    closed: () => closed,
  };
}

describe('browser session lifecycle', () => {
  it('closes the browser it started when the open fails', async () => {
    const { host, started, closed } = silentHost();
    const session = new BrowserSession(150);

    await assert.rejects(session.open(host, 'https://example.invalid'), /CDP endpoint/);

    assert.equal(started(), 1);
    // Without this, every failed open left a headless browser running and every
    // retry left another.
    assert.equal(closed(), 1, 'the started browser was not closed');
  });

  it('does not accumulate browsers across repeated failures', async () => {
    const { host, started, closed } = silentHost();
    const session = new BrowserSession(150);

    await assert.rejects(session.open(host, 'https://example.invalid'), /CDP endpoint/);
    await assert.rejects(session.open(host, 'https://example.invalid'), /CDP endpoint/);

    assert.equal(started(), 2);
    assert.equal(closed(), 2);
  });

  it('leaves no session state behind after a failed open', async () => {
    const { host } = silentHost();
    const session = new BrowserSession(150);

    await assert.rejects(session.open(host, 'https://example.invalid'), /CDP endpoint/);
    // A half-open session that still looked open would make the next command
    // talk to a browser that is not there.
    await assert.rejects(session.read(), /Browser is not open/);
  });
});
