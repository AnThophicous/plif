import crypto from 'node:crypto';
import { chromium } from 'playwright-core';

/** The browser only receives this narrow, policy-bearing terminal surface. */
export interface BrowserHost {
  startTerminal(request: { argv: readonly string[]; cwd?: string; reason: string }): Promise<{ terminalId: string; ownerId: string }>;
  readTerminal(id: string, ownerId: string): Promise<readonly { readonly stream: string; readonly chunk: string }[]>;
  closeTerminal(id: string, ownerId: string): Promise<unknown>;
}

interface Reply { id?: number; result?: Record<string, unknown>; error?: { message?: string } }

/** Tiny CDP client; Chromium launches through the PLIF terminal, never the host. */
export class BrowserSession {
  #socket: WebSocket | null = null;
  #terminal: { id: string; owner: string } | null = null;
  #sessionId: string | null = null;
  #host: BrowserHost | null = null;
  #nextId = 1;
  #pending = new Map<number, { resolve(value: Reply): void; reject(error: Error): void }>();

  async open(host: BrowserHost, url: string): Promise<string> {
    await this.#ensure(host);
    await this.#command('Page.navigate', { url });
    await new Promise((resolve) => setTimeout(resolve, 20));
    return String(await this.evaluate('document.title'));
  }
  async read(): Promise<string> { return String(await this.evaluate('document.body?.innerText ?? ""')).trim(); }
  async click(selector: string): Promise<void> { await this.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('No element matches selector'); e.click(); })()`); }
  async type(selector: string, text: string): Promise<void> { await this.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!(e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement || e instanceof HTMLElement && e.isContentEditable)) throw new Error('Selector is not editable'); e.focus(); e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`); }
  async evaluate(expression: string): Promise<unknown> {
    const result = await this.#command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    const exception = result.exceptionDetails as { text?: string } | undefined;
    if (exception) throw new Error(exception.text ?? 'Page evaluation failed');
    const value = result.result as { value?: unknown; description?: string } | undefined;
    return value?.value ?? value?.description;
  }
  async screenshot(): Promise<string> { return String((await this.#command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).data ?? ''); }
  async close(): Promise<void> {
    const socket = this.#socket; this.#socket = null; this.#sessionId = null;
    for (const pending of this.#pending.values()) pending.reject(new Error('Browser closed'));
    this.#pending.clear(); socket?.close();
    const terminal = this.#terminal; this.#terminal = null;
    if (terminal) await this.#host?.closeTerminal(terminal.id, terminal.owner).catch(() => undefined);
    this.#host = null;
  }

  async #ensure(host: BrowserHost): Promise<void> {
    if (this.#socket) return;
    this.#host = host;
    const executable = chromium.executablePath();
    if (!executable) throw new Error('Bundled Chromium is unavailable. Install @playwright/browser-chromium.');
    const started = await host.startTerminal({
      // The PLIF container is the security boundary. Chromium's Windows child
      // sandbox cannot re-open an executable mounted into that already-sandboxed
      // process, so its inner sandbox must be disabled here.
      argv: [executable, '--headless=new', '--no-sandbox', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=/temp/plif-browser-${crypto.randomUUID()}`, '--no-first-run', '--no-default-browser-check', 'about:blank'],
      reason: 'run the isolated PLIF browser through Chrome DevTools Protocol',
    });
    this.#terminal = { id: started.terminalId, owner: started.ownerId };
    const inspector = await this.#inspectorUrl(host, started.terminalId, started.ownerId);
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(inspector);
      socket.addEventListener('open', () => { this.#socket = socket; resolve(); }, { once: true });
      socket.addEventListener('error', () => reject(new Error('Could not connect to the isolated browser')), { once: true });
      socket.addEventListener('message', (event) => this.#onMessage(String(event.data)));
    });
    const created = await this.#raw('Target.createTarget', { url: 'about:blank' });
    const attached = await this.#raw('Target.attachToTarget', { targetId: created.targetId, flatten: true });
    this.#sessionId = String(attached.sessionId);
  }
  async #inspectorUrl(host: BrowserHost, id: string, owner: string): Promise<string> {
    const until = Date.now() + 10_000; let output = '';
    while (Date.now() < until) {
      output += (await host.readTerminal(id, owner)).map((chunk) => chunk.chunk).join('');
      const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/.exec(output);
      if (match) return match[1]!;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Chromium did not publish a loopback CDP endpoint.${output ? ` ${output.trim().slice(-400)}` : ''}`);
  }
  async #command(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!this.#sessionId) throw new Error('Browser is not open');
    return await this.#raw(method, params, this.#sessionId);
  }
  async #raw(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    const socket = this.#socket; if (!socket) throw new Error('Browser is not open');
    const id = this.#nextId++;
    const reply = new Promise<Reply>((resolve, reject) => this.#pending.set(id, { resolve, reject }));
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    const response = await reply;
    if (response.error) throw new Error(response.error.message ?? `CDP ${method} failed`);
    return response.result ?? {};
  }
  #onMessage(raw: string): void {
    try { const message = JSON.parse(raw) as Reply; if (!message.id) return; const pending = this.#pending.get(message.id); if (!pending) return; this.#pending.delete(message.id); pending.resolve(message); } catch { /* Ignore malformed inspector traffic. */ }
  }
}
