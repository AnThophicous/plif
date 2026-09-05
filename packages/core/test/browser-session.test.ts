import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BrowserSession } from '../src/browser/session.js';

describe('BrowserSession', () => {
  it('uses a disposable profile and preserves page state across actions', async () => {
    const session = new BrowserSession();
    try {
      assert.equal(await session.open('data:text/html,<title>PLIF</title><button id=x>go</button><main>cold</main><script>x.onclick=()=>document.querySelector(\'main\').textContent=\'warm\'</script>'), 'PLIF');
      await session.click('#x');
      assert.equal(await session.read(), 'go\nwarm');
    } finally { await session.close(); }
  });
});
