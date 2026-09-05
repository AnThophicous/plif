import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { platformMcpOAuthStore, type McpOAuthStore } from './store.js';

/** OpenCode-compatible ChatGPT OAuth constants. This is deliberately separate
 * from the Codex app-server: OAuth calls stay in PLIF's OpenAI provider. */
export const OPENAI_OAUTH_ISSUER = 'https://auth.openai.com';
export const OPENAI_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const OPENAI_CODEX_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';

/** How long either sign-in flow waits for the person at the browser. */
const LOGIN_TIMEOUT_MS = 5 * 60_000;
export const OPENAI_OAUTH_REDIRECT_URI = 'http://localhost:1455/auth/callback';

export interface OpenAIOAuthTokens {
  readonly access: string;
  readonly refresh: string;
  readonly expires: number;
  readonly accountId?: string;
}

export interface OpenAIOAuthMethod {
  readonly label: 'ChatGPT Pro/Plus (browser)' | 'ChatGPT Pro/Plus (headless)' | 'Manually enter API Key';
  readonly type: 'oauth' | 'api';
}

export const OPENAI_AUTH_METHODS: readonly OpenAIOAuthMethod[] = Object.freeze([
  { label: 'ChatGPT Pro/Plus (browser)', type: 'oauth' },
  { label: 'ChatGPT Pro/Plus (headless)', type: 'oauth' },
  { label: 'Manually enter API Key', type: 'api' },
]);

interface TokenResponse { id_token?: string; access_token: string; refresh_token: string; expires_in?: number }
interface Pkce { verifier: string; challenge: string }

const b64url = (value: Uint8Array | Buffer): string => Buffer.from(value).toString('base64url');
export function generateOpenAIPkce(): Pkce {
  const verifier = b64url(randomBytes(32));
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildOpenAIAuthorizeUrl(pkce: Pkce, state: string, redirectUri = OPENAI_OAUTH_REDIRECT_URI): string {
  const params = new URLSearchParams({ response_type: 'code', client_id: OPENAI_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri, scope: 'openid profile email offline_access', code_challenge: pkce.challenge,
    code_challenge_method: 'S256', id_token_add_organizations: 'true', codex_cli_simplified_flow: 'true',
    state, originator: 'opencode' });
  return `${OPENAI_OAUTH_ISSUER}/oauth/authorize?${params}`;
}

function accountId(token?: string): string | undefined {
  if (!token) return undefined;
  try { const part = token.split('.')[1]; if (!part) return undefined; const p = JSON.parse(Buffer.from(part, 'base64url').toString());
    return p.chatgpt_account_id ?? p['https://api.openai.com/auth']?.chatgpt_account_id ?? p.organizations?.[0]?.id;
  } catch { return undefined; }
}
function normalize(t: TokenResponse): OpenAIOAuthTokens {
  return { access: t.access_token, refresh: t.refresh_token, expires: Date.now() + (t.expires_in ?? 3600) * 1000,
    accountId: accountId(t.id_token) ?? accountId(t.access_token) };
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(`${OPENAI_OAUTH_ISSUER}/oauth/token`, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!response.ok) throw new Error(`OpenAI OAuth token request failed: ${response.status}`);
  return response.json() as Promise<TokenResponse>;
}

export async function refreshOpenAIAccessToken(refresh: string): Promise<OpenAIOAuthTokens> {
  return normalize(await tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: OPENAI_OAUTH_CLIENT_ID })));
}

export class OpenAIOAuthClient {
  readonly #store: McpOAuthStore;
  readonly #key: string;
  #server?: Server;
  #refreshing?: Promise<OpenAIOAuthTokens>;
  constructor(store: McpOAuthStore = platformMcpOAuthStore(), key = 'openai') { this.#store = store; this.#key = key; }

  async load(): Promise<OpenAIOAuthTokens | undefined> {
    const state = await this.#store.load(this.#key);
    const t = state?.tokens as (TokenResponse & { expires?: number; accountId?: string }) | undefined;
    if (!t?.access_token) return undefined;
    // A token saved before `expires` was persisted has no absolute deadline to
    // recover, so it is treated as due: one refresh, and from then on the real
    // expiry is on disk. Reconstructing it from `expires_in` would be worse — it
    // would silently extend a token that may already be dead.
    return {
      access: t.access_token,
      refresh: t.refresh_token,
      expires: typeof t.expires === 'number' ? t.expires : 0,
      accountId: t.accountId ?? accountId(t.id_token),
    };
  }
  async save(tokens: OpenAIOAuthTokens): Promise<void> {
    // `expires` is the field this client reads back. `expires_in` is kept beside
    // it because the stored shape is an OAuth token response and other readers
    // expect it, but a duration alone is meaningless once it is on disk: without
    // the absolute deadline every load looked expired and every single request
    // spent a refresh, which is how a fresh login started failing on its first
    // message.
    await this.#store.save(this.#key, {
      tokens: {
        access_token: tokens.access,
        refresh_token: tokens.refresh,
        token_type: 'Bearer',
        expires: tokens.expires,
        expires_in: Math.max(0, Math.floor((tokens.expires - Date.now()) / 1000)),
        ...(tokens.accountId ? { accountId: tokens.accountId } : {}),
      } as never,
    });
  }
  async disconnect(): Promise<void> {
    await this.#store.clear(this.#key, 'all');
  }
  async accessToken(): Promise<string | undefined> {
    let current = await this.load();
    if (!current) return undefined;
    if (current.expires <= Date.now() + 30_000) {
      this.#refreshing ??= refreshOpenAIAccessToken(current.refresh).then(async (next) => { await this.save(next); return next; }).finally(() => { this.#refreshing = undefined; });
      current = await this.#refreshing;
    }
    return current.access;
  }
  /**
   * Sign in through the browser, on a loopback callback.
   *
   * Every exit closes the listener. Without that, a cancelled or failed attempt
   * left port 1455 bound for the life of the process, and the next attempt failed
   * on bind rather than on anything the user did — so "re-run /providers" could
   * never succeed once the first try went wrong.
   */
  async startBrowserLogin(
    open?: (url: string) => Promise<void>,
    timeoutMs = LOGIN_TIMEOUT_MS,
  ): Promise<OpenAIOAuthTokens> {
    const pkce = generateOpenAIPkce(); const state = b64url(randomBytes(32));
    try {
      const code = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Browser sign-in timed out before the callback arrived')),
          timeoutMs,
        );
        timer.unref?.();
        const settle = (run: () => void): void => { clearTimeout(timer); run(); };

        this.#server = createServer((req, res) => { const url = new URL(req.url ?? '/', OPENAI_OAUTH_REDIRECT_URI);
          if (url.pathname !== '/auth/callback') { res.writeHead(404); res.end(); return; }
          if (url.searchParams.get('state') !== state) { res.writeHead(400); res.end('Invalid state'); settle(() => reject(new Error('Invalid OAuth state'))); return; }
          const error = url.searchParams.get('error'); if (error) { res.end('Login failed'); settle(() => reject(new Error(error))); return; }
          const value = url.searchParams.get('code'); if (!value) { res.end('Missing code'); settle(() => reject(new Error('Missing authorization code'))); return; }
          res.end('Login complete. You can close this window.'); settle(() => resolve(value));
        });
        this.#server.once('error', (cause) => settle(() => reject(cause)));
        this.#server.listen(1455, '127.0.0.1', async () => { await open?.(buildOpenAIAuthorizeUrl(pkce, state)); });
      });
      const result = normalize(await tokenRequest(new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: OPENAI_OAUTH_REDIRECT_URI, client_id: OPENAI_OAUTH_CLIENT_ID, code_verifier: pkce.verifier })));
      await this.save(result);
      return result;
    } finally {
      this.#server?.close();
      this.#server = undefined;
    }
  }
  async startHeadlessLogin(waitMs = 5_000, signal?: AbortSignal, onCode?: (code: string, url: string) => void): Promise<OpenAIOAuthTokens> {
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    const headers = { 'Content-Type': 'application/json', 'User-Agent': 'plif/openai-oauth' };
    const response = await fetch(`${OPENAI_OAUTH_ISSUER}/api/accounts/deviceauth/usercode`, { method: 'POST', headers, body: JSON.stringify({ client_id: OPENAI_OAUTH_CLIENT_ID }), signal });
    if (!response.ok) throw new Error(`Device authorization failed: ${response.status}`);
    const data = await response.json() as { device_auth_id: string; user_code: string; interval?: string };
    onCode?.(data.user_code, `${OPENAI_OAUTH_ISSUER}/codex/device`);
    for (;;) { const poll = await fetch(`${OPENAI_OAUTH_ISSUER}/api/accounts/deviceauth/token`, { method: 'POST', headers, body: JSON.stringify({ device_auth_id: data.device_auth_id, user_code: data.user_code }), signal });
      if (poll.ok) { const auth = await poll.json() as { authorization_code: string; code_verifier: string }; const t = normalize(await tokenRequest(new URLSearchParams({ grant_type: 'authorization_code', code: auth.authorization_code, redirect_uri: `${OPENAI_OAUTH_ISSUER}/deviceauth/callback`, client_id: OPENAI_OAUTH_CLIENT_ID, code_verifier: auth.code_verifier }))); await this.save(t); return t; }
      if (poll.status !== 403 && poll.status !== 404) throw new Error(`Device authorization failed: ${poll.status}`);
      // A code nobody ever types must not leave this polling for the life of the
      // process. The abort signal covers a user who cancels; the deadline covers
      // the one who walks away.
      if (Date.now() > deadline) throw new Error('Device sign-in timed out before the code was entered');
      await new Promise(r => setTimeout(r, Math.max(1, Number(data.interval) || 5) * 1000 + waitMs));
    }
  }
}
