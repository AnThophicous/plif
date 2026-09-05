import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { describe, it } from 'node:test';
import { BrowserSession, type BrowserHost } from '../src/browser/session.js';

function terminalHost(): BrowserHost & { starts: number; reason: string } {
  let child: ChildProcess | null = null; let output = ''; let starts = 0; let reason = '';
  return {
    get starts() { return starts; }, get reason() { return reason; },
    async startTerminal(request) {
      starts++; reason = request.reason;
      child = spawn(request.argv[0]!, [...request.argv.slice(1)], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      child.stderr?.on('data', (chunk) => { output += String(chunk); });
      return { terminalId: 'browser', ownerId: 'test' };
    },
    async readTerminal() { const chunk = output; output = ''; return chunk ? [{ stream: 'stderr', chunk }] : []; },
    async closeTerminal() { child?.kill(); },
  };
}

describe('BrowserSession', () => {
  it('uses the policy-bearing terminal and preserves page state across CDP actions', async () => {
    const session = new BrowserSession(); const host = terminalHost();
    try {
      assert.equal(await session.open(host, 'data:text/html,<title>PLIF</title><button id=x>go</button><main>cold</main><script>x.onclick=()=>document.querySelector(\'main\').textContent=\'warm\'</script>'), 'PLIF');
      await session.click('#x');
      assert.equal(await session.read(), 'go\nwarm');
      assert.equal(host.starts, 1);
      assert.match(host.reason, /isolated PLIF browser/);
    } finally { await session.close(); }
  });
});
