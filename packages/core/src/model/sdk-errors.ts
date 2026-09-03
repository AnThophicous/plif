/**
 * Duck-typed identification of OpenAI/Anthropic SDK errors.
 *
 * The providers load their SDK lazily — importing `openai` and
 * `@anthropic-ai/sdk` at module scope cost ~200ms of startup for hundreds of
 * tiny ESM files that a session may never need. `instanceof` would drag the
 * whole SDK back in, so error classification walks the prototype chain by
 * constructor name instead. The SDKs' class names are part of their public
 * surface (they are re-exported by name), and the dist builds are not
 * minified, so the names are stable.
 */

/** True when `error`'s prototype chain contains a class called `className`. */
export function isSdkError(error: unknown, className: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  let proto: object | null = Object.getPrototypeOf(error) as object | null;
  while (proto !== null) {
    const ctor = (proto as { constructor?: { name?: string } }).constructor;
    if (ctor?.name === className) return true;
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return false;
}

/** The SDK error thrown when the caller's `AbortSignal` fires. */
export function isUserAbortError(error: unknown): boolean {
  return isSdkError(error, 'APIUserAbortError') || (error as Error | null)?.name === 'AbortError';
}

export function isApiConnectionTimeoutError(error: unknown): boolean {
  return isSdkError(error, 'APIConnectionTimeoutError');
}

export function isApiConnectionError(error: unknown): boolean {
  return isSdkError(error, 'APIConnectionError');
}

export function isApiError(error: unknown): boolean {
  return isSdkError(error, 'APIError');
}

/**
 * Stand-in for the SDK's abort error, thrown by the provider's own stream
 * deadline helpers. Deliberately named for the SDK class so that both this and
 * the SDK's own instances answer to `isUserAbortError`.
 */
export class APIUserAbortError extends Error {
  constructor(message = 'Request was aborted.') {
    super(message);
    this.name = 'APIUserAbortError';
  }
}
