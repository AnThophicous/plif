import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import http from 'node:http';

import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

import { PlifError } from '../errors.js';
import type { EventBus } from '../events/bus.js';
import {
  WindowsDpapiOAuthStore,
  mcpOAuthKey,
  type McpOAuthStore,
  type OAuthCredentialScope,
  type StoredMcpOAuthState,
} from './store.js';

export interface McpOAuthConfig {
  readonly clientMetadataUrl?: string;
  readonly scope?: string;
}

export interface McpAuthEvent {
  readonly requestId: string;
  readonly server: string;
  readonly phase: 'required' | 'opened' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  readonly domain?: string;
  readonly authorizationUrl?: string;
  readonly scope?: string;
  readonly detail?: string;
}

export interface McpOAuthCoordinatorOptions {
  readonly store?: McpOAuthStore;
  readonly openBrowser?: (url: URL) => Promise<void>;
  readonly interactive?: boolean;
  readonly timeoutMs?: number;
}

export interface OAuthBrowserCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export function oauthBrowserCommand(
  url: URL,
  platform: NodeJS.Platform = process.platform,
): OAuthBrowserCommand {
  if (platform === 'win32') {
    // Never use `cmd /c start`: cmd treats every `&` in an OAuth query as a
    // command separator, so the browser receives only the first parameter.
    return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url.toString()] };
  }
  return platform === 'darwin'
    ? { command: 'open', args: [url.toString()] }
    : { command: 'xdg-open', args: [url.toString()] };
}

export function validateOAuthAuthorizationUrl(url: URL): void {
  const required = ['response_type', 'client_id', 'redirect_uri', 'state'];
  const missing = required.filter((name) => !url.searchParams.get(name));
  if (url.searchParams.has('code_challenge_method') && !url.searchParams.get('code_challenge')) {
    missing.push('code_challenge');
  }
  if (missing.length > 0) {
    throw new PlifError(
      'MODEL_AUTH',
      `OAuth authorization URL is missing required parameters: ${missing.join(', ')}`,
    );
  }
}

interface PendingCallback {
  readonly provider: McpOAuthProvider;
  readonly resolve: (code: string) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export async function openOAuthBrowser(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PlifError('INVALID_ARGUMENT', 'OAuth authorization URL must use HTTP or HTTPS');
  }
  const { command, args } = oauthBrowserCommand(url);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, shell: false, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export class McpOAuthCoordinator {
  readonly #bus: EventBus | undefined;
  readonly #store: McpOAuthStore;
  readonly #openBrowser: (url: URL) => Promise<void>;
  readonly #interactive: boolean;
  readonly #timeoutMs: number;
  readonly #pending = new Map<string, PendingCallback>();
  #server: http.Server | undefined;
  #callbackUrl: URL | undefined;

  constructor(bus?: EventBus, options: McpOAuthCoordinatorOptions = {}) {
    this.#bus = bus;
    this.#store = options.store ?? new WindowsDpapiOAuthStore();
    this.#openBrowser = options.openBrowser ?? openOAuthBrowser;
    this.#interactive = options.interactive ?? true;
    this.#timeoutMs = options.timeoutMs ?? 5 * 60_000;
  }

  async start(): Promise<void> {
    if (this.#server) return;
    this.#server = http.createServer((request, response) => this.#handleCallback(request, response));
    await new Promise<void>((resolve, reject) => {
      this.#server!.once('error', reject);
      this.#server!.listen(0, '127.0.0.1', resolve);
    });
    const address = this.#server.address();
    if (!address || typeof address === 'string') throw new PlifError('INTERNAL', 'OAuth callback listener failed');
    this.#callbackUrl = new URL(`http://127.0.0.1:${address.port}/oauth/callback`);
  }

  providerFor(server: string, url: URL, config: McpOAuthConfig = {}): McpOAuthProvider {
    if (!this.#callbackUrl) throw new PlifError('INTERNAL', 'OAuth coordinator has not started');
    return new McpOAuthProvider(this, server, url, config, this.#store, this.#callbackUrl);
  }

  register(state: string, provider: McpOAuthProvider): Promise<string> {
    const previous = this.#pending.get(state);
    if (previous) return provider.callbackPromise!;
    const promise = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(state);
        provider.completeCallback();
        reject(new PlifError('MODEL_TIMEOUT', 'OAuth login timed out'));
      }, this.#timeoutMs);
      timer.unref?.();
      this.#pending.set(state, { provider, resolve, reject, timer });
    });
    promise.catch(() => undefined);
    return promise;
  }

  async authorize(provider: McpOAuthProvider, authorizationUrl: URL): Promise<void> {
    try {
      validateOAuthAuthorizationUrl(authorizationUrl);
    } catch (error) {
      this.#cancel(provider, error instanceof Error ? error.message : 'invalid OAuth authorization URL');
      throw error;
    }
    const requestId = provider.requestId;
    const base = {
      requestId,
      server: provider.server,
      domain: authorizationUrl.hostname,
      authorizationUrl: authorizationUrl.toString(),
      ...(provider.scope ? { scope: provider.scope } : {}),
    };
    this.#bus?.emit('auth.required', { ...base, phase: 'required' });
    if (!this.#interactive) {
      this.#cancel(provider, 'OAuth login needs an interactive terminal');
      this.#bus?.emit('auth.required', { ...base, phase: 'failed', detail: 'interactive login required' });
      throw new PlifError(
        'MODEL_AUTH',
        `needs an interactive OAuth login: run plif in a terminal to authorize ${authorizationUrl.hostname}`,
      );
    }
    let opened = true;
    try {
      await this.#openBrowser(authorizationUrl);
    } catch {
      opened = false;
    }
    if (opened) this.#bus?.emit('auth.required', { ...base, phase: 'opened' });
    this.#bus?.emit('auth.required', {
      ...base,
      phase: 'waiting',
      ...(opened ? {} : { detail: 'no browser could be opened — visit the URL yourself to finish' }),
    });
  }

  async close(): Promise<void> {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.provider.completeCallback();
      pending.reject(new PlifError('MODEL_AUTH', 'OAuth login cancelled'));
    }
    this.#pending.clear();
    if (!this.#server) return;
    await new Promise<void>((resolve) => this.#server!.close(() => resolve()));
    this.#server = undefined;
    this.#callbackUrl = undefined;
  }

  #cancel(provider: McpOAuthProvider, reason: string): void {
    for (const [state, pending] of this.#pending) {
      if (pending.provider !== provider) continue;
      this.#pending.delete(state);
      clearTimeout(pending.timer);
      pending.reject(new PlifError('MODEL_AUTH', reason));
    }
    provider.completeCallback();
  }

  #handleCallback(request: http.IncomingMessage, response: http.ServerResponse): void {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method !== 'GET' || url.pathname !== '/oauth/callback') {
      response.writeHead(404).end('Not found');
      return;
    }
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const pending = state ? this.#pending.get(state) : undefined;
    if (!state || !code || !pending) {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Invalid or expired OAuth callback.');
      return;
    }
    this.#pending.delete(state);
    clearTimeout(pending.timer);
    pending.resolve(code);
    this.#bus?.emit('auth.required', {
      requestId: pending.provider.requestId,
      server: pending.provider.server,
      phase: 'completed',
      domain: pending.provider.endpoint.hostname,
    });
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><title>Plif</title><p>Authorization complete. You can close this tab.</p>');
  }
}

export class McpOAuthProvider implements OAuthClientProvider {
  readonly server: string;
  readonly endpoint: URL;
  readonly scope: string | undefined;
  readonly clientMetadataUrl: string | undefined;
  readonly #coordinator: McpOAuthCoordinator;
  readonly #store: McpOAuthStore;
  readonly #key: string;
  readonly #redirectUrl: URL;
  requestId = randomUUID();
  #state: string | undefined;
  callbackPromise: Promise<string> | undefined;
  #pending = false;

  constructor(coordinator: McpOAuthCoordinator, server: string, endpoint: URL, config: McpOAuthConfig, store: McpOAuthStore, redirectUrl: URL) {
    this.#coordinator = coordinator;
    this.server = server;
    this.endpoint = endpoint;
    this.scope = config.scope;
    this.clientMetadataUrl = config.clientMetadataUrl;
    this.#store = store;
    this.#key = mcpOAuthKey(server, endpoint.toString());
    this.#redirectUrl = redirectUrl;
  }

  get redirectUrl(): URL { return this.#redirectUrl; }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.#redirectUrl.toString()],
      client_name: 'Plif',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(this.scope ? { scope: this.scope } : {}),
    };
  }

  state(): string {
    this.requestId = randomUUID();
    this.#state = randomUUID();
    this.#pending = true;
    this.callbackPromise = this.#coordinator.register(this.#state, this);
    return this.#state;
  }

  async waitForCallback(): Promise<string> {
    const promise = this.callbackPromise;
    if (!promise) throw new PlifError('MODEL_AUTH', 'OAuth callback is not pending');
    try {
      return await promise;
    } finally {
      this.completeCallback();
    }
  }

  hasPendingCallback(): boolean { return this.#pending; }

  completeCallback(): void {
    this.#pending = false;
    this.callbackPromise = undefined;
  }

  async redirectToAuthorization(url: URL): Promise<void> { await this.#coordinator.authorize(this, url); }
  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> { return (await this.#store.load(this.#key))?.clientInformation; }
  async saveClientInformation(value: OAuthClientInformationMixed): Promise<void> { await this.#patch({ clientInformation: value }); }
  async tokens(): Promise<OAuthTokens | undefined> { return (await this.#store.load(this.#key))?.tokens; }
  async saveTokens(value: OAuthTokens): Promise<void> { await this.#patch({ tokens: value }); }
  async saveCodeVerifier(value: string): Promise<void> { await this.#patch({ codeVerifier: value }); }
  async codeVerifier(): Promise<string> {
    const value = (await this.#store.load(this.#key))?.codeVerifier;
    if (!value) throw new PlifError('MODEL_AUTH', 'OAuth code verifier is unavailable');
    return value;
  }
  async saveDiscoveryState(value: OAuthDiscoveryState): Promise<void> { await this.#patch({ discoveryState: value }); }
  async discoveryState(): Promise<OAuthDiscoveryState | undefined> { return (await this.#store.load(this.#key))?.discoveryState; }
  async invalidateCredentials(scope: OAuthCredentialScope): Promise<void> { await this.#store.clear(this.#key, scope); }

  async #patch(patch: Partial<StoredMcpOAuthState>): Promise<void> {
    await this.#store.save(this.#key, { ...(await this.#store.load(this.#key)), ...patch });
  }
}
