import crypto from 'node:crypto';
import { chromium } from 'playwright-core';

/** The browser only receives this narrow, policy-bearing terminal surface. */
export interface BrowserHost {
  startTerminal(request: { argv: readonly string[]; cwd?: string; reason: string }): Promise<{ terminalId: string; ownerId: string }>;
  readTerminal(id: string, ownerId: string): Promise<readonly { readonly stream: string; readonly chunk: string }[]>;
  closeTerminal(id: string, ownerId: string): Promise<unknown>;
}

interface Reply { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message?: string } }

/** One request the page made, as the network log reports it. */
export interface NetworkEntry {
  readonly method: string;
  readonly url: string;
  readonly status?: number;
  readonly mimeType?: string;
}

/**
 * How many requests to keep.
 *
 * A single page load can be hundreds, and the log exists to answer "what did
 * this page call", not to be a complete capture. The oldest go first.
 */
const NETWORK_LIMIT = 200;

/** How long one CDP command may wait before the browser is presumed gone. */
const COMMAND_TIMEOUT_MS = 30_000;

/** How long Chromium is given to print its loopback CDP endpoint. */
const ENDPOINT_TIMEOUT_MS = 10_000;

/** Tiny CDP client; Chromium launches through the PLIF terminal, never the host. */
export class BrowserSession {
  #socket: WebSocket | null = null;
  #terminal: { id: string; owner: string } | null = null;
  #sessionId: string | null = null;
  #host: BrowserHost | null = null;
  #nextId = 1;
  #pending = new Map<number, { resolve(value: Reply): void; reject(error: Error): void }>();
  #requests = new Map<string, { method: string; url: string }>();
  #network: NetworkEntry[] = [];
  readonly #endpointTimeoutMs: number;

  /** The wait for Chromium to publish its endpoint, shortened by tests. */
  constructor(endpointTimeoutMs = ENDPOINT_TIMEOUT_MS) {
    this.#endpointTimeoutMs = endpointTimeoutMs;
  }

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

  /**
   * What the page has asked the network for.
   *
   * Read from the events already arriving on the same socket rather than by
   * asking, because a request that has finished cannot be queried afterwards —
   * if nothing recorded it while it happened, it is simply gone.
   */
  network(): readonly NetworkEntry[] { return this.#network; }

  async close(): Promise<void> {
    const socket = this.#socket; this.#socket = null; this.#sessionId = null;
    for (const pending of this.#pending.values()) pending.reject(new Error('Browser closed'));
    this.#pending.clear(); socket?.close();
    this.#requests.clear(); this.#network = [];
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

    // Chromium is already running by this point. Three things can still fail —
    // the endpoint never being printed, the socket refusing, the first CDP
    // command — and none of them used to close it, so every failed open left a
    // headless browser behind and a retry left another.
    try {
      const inspector = await this.#inspectorUrl(host, started.terminalId, started.ownerId);
      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(inspector);
        socket.addEventListener('open', () => { this.#socket = socket; resolve(); }, { once: true });
        socket.addEventListener('error', () => reject(new Error('Could not connect to the isolated browser')), { once: true });
        socket.addEventListener('message', (event) => this.#onMessage(String(event.data)));
        // Losing the socket fails every waiter instead of stranding it.
        const lost = (): void => {
          for (const pending of this.#pending.values()) pending.reject(new Error('Browser closed'));
          this.#pending.clear();
        };
        socket.addEventListener('close', lost);
        socket.addEventListener('error', lost);
      });
      const created = await this.#raw('Target.createTarget', { url: 'about:blank' });
      const attached = await this.#raw('Target.attachToTarget', { targetId: created.targetId, flatten: true });
      this.#sessionId = String(attached.sessionId);
      // Enabled up front: the log has to be running before the first navigation,
      // or the page load nobody was watching is the one that is never explained.
      await this.#command('Network.enable', {}).catch(() => undefined);
    } catch (error) {
      const terminal = this.#terminal;
      this.#terminal = null;
      (this.#socket as WebSocket | null)?.close();
      this.#socket = null;
      this.#sessionId = null;
      this.#host = null;
      if (terminal) await host.closeTerminal(terminal.id, terminal.owner).catch(() => undefined);
      throw error;
    }
  }
  async #inspectorUrl(host: BrowserHost, id: string, owner: string): Promise<string> {
    const until = Date.now() + this.#endpointTimeoutMs; let output = '';
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
    // Nothing else ever settles these. A browser that dies mid-command used to
    // leave the caller waiting for a reply that could not arrive.
    const reply = new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Browser did not answer ${method}`));
      }, COMMAND_TIMEOUT_MS);
      timer.unref?.();
      this.#pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (cause) => { clearTimeout(timer); reject(cause); },
      });
    });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    const response = await reply;
    if (response.error) throw new Error(response.error.message ?? `CDP ${method} failed`);
    return response.result ?? {};
  }
  #onMessage(raw: string): void {
    try {
      const message = JSON.parse(raw) as Reply;
      if (!message.id) { this.#onEvent(message); return; }
      const pending = this.#pending.get(message.id); if (!pending) return;
      this.#pending.delete(message.id); pending.resolve(message);
    } catch { /* Ignore malformed inspector traffic. */ }
  }
  #onEvent(message: Reply): void {
    const params = message.params ?? {};
    const requestId = typeof params['requestId'] === 'string' ? params['requestId'] : null;
    if (!requestId) return;

    if (message.method === 'Network.requestWillBeSent') {
      const request = params['request'] as { method?: string; url?: string } | undefined;
      if (!request?.url) return;
      this.#requests.set(requestId, { method: request.method ?? 'GET', url: request.url });
      return;
    }
    if (message.method !== 'Network.responseReceived') return;

    const response = params['response'] as { status?: number; mimeType?: string; url?: string } | undefined;
    const sent = this.#requests.get(requestId);
    this.#requests.delete(requestId);
    const url = sent?.url ?? response?.url;
    if (!url) return;

    this.#network.push({
      method: sent?.method ?? 'GET',
      url,
      ...(response?.status === undefined ? {} : { status: response.status }),
      ...(response?.mimeType ? { mimeType: response.mimeType } : {}),
    });
    if (this.#network.length > NETWORK_LIMIT) this.#network.splice(0, this.#network.length - NETWORK_LIMIT);
  }
}
