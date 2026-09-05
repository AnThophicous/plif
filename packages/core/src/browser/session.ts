import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';

/** Disposable Chromium session. The bundled browser never receives the user's
 * default profile; every cookie/cache belongs to this temporary directory. */
export class BrowserSession {
  #browser: BrowserContext | null = null;
  #page: Page | null = null;
  #profile: string | null = null;
  async open(url: string): Promise<string> {
    if (!this.#browser) {
      this.#profile = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-browser-'));
      this.#browser = await chromium.launchPersistentContext(this.#profile, { headless: true, args: ['--no-first-run', '--no-default-browser-check'] });
      this.#page = this.#browser.pages()[0] ?? await this.#browser.newPage();
    }
    await this.#page!.goto(url, { waitUntil: 'domcontentloaded' });
    return await this.#page!.title();
  }
  async read(): Promise<string> { return (await this.#page!.locator('body').innerText()).trim(); }
  async click(selector: string): Promise<void> { await this.#page!.locator(selector).click(); }
  async type(selector: string, text: string): Promise<void> { await this.#page!.locator(selector).fill(text); }
  async evaluate(expression: string): Promise<unknown> { return await this.#page!.evaluate(expression); }
  async screenshot(): Promise<Buffer> { return await this.#page!.screenshot({ fullPage: true }); }
  async close(): Promise<void> { await this.#browser?.close(); if (this.#profile) await fs.rm(this.#profile, { recursive: true, force: true }); this.#browser = null; this.#page = null; this.#profile = null; }
}
