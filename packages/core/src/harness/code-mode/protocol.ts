/**
 * The wire between the host and the program's runtime process.
 *
 * The program on the other end is model-written code. It is not a component of
 * this system and it is not assumed to be cooperative: it can reach its own
 * socket, forge frames, replay ids, send megabytes, or claim to be a tool call
 * that was never made. So every inbound frame is *rebuilt* from own properties
 * rather than read in place, every id is answered at most once, and anything
 * that is not lossless JSON is refused rather than coerced.
 *
 * Newline-delimited JSON is the framing. It is legible in a transcript, it
 * needs no length prefix to resynchronise after a bad frame, and a program that
 * writes garbage produces one rejected line instead of a desynchronised stream.
 */

/** Frames the runtime sends to the host. */
export type InboundFrame =
  | { readonly t: 'hello'; readonly token: string }
  | { readonly t: 'call'; readonly id: number; readonly name: string; readonly args: Record<string, unknown> }
  | { readonly t: 'log'; readonly text: string }
  | { readonly t: 'done'; readonly value: unknown; readonly hasValue: boolean }
  | { readonly t: 'fail'; readonly kind: string; readonly message: string };

/** Frames the host sends to the runtime. */
export type OutboundFrame =
  | { readonly t: 'ready' }
  | { readonly t: 'result'; readonly id: number; readonly output: string; readonly diff?: string }
  | { readonly t: 'error'; readonly id: number; readonly message: string };

/** A single frame may not exceed this. A program that needs more is misusing the seam. */
export const MAX_FRAME_BYTES = 4 * 1024 * 1024;

export function encodeFrame(frame: OutboundFrame): string {
  return `${JSON.stringify(frame)}\n`;
}

/**
 * Whether a value survives a JSON round trip unchanged.
 *
 * `JSON.stringify` is lossy in ways that matter here: `undefined` disappears
 * from objects, `NaN` and `Infinity` become `null`, and a `toJSON` method can
 * substitute something else entirely. A program whose result quietly changed
 * shape on the way to the model would be debugging a value it never produced,
 * so anything that would not round-trip is rejected at the boundary instead.
 */
export function isJsonLossless(value: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  if (value === null) return true;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object':
      break;
    default:
      return false;
  }
  if (Array.isArray(value)) return value.every((entry) => isJsonLossless(entry, depth + 1));
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([, entry]) => isJsonLossless(entry, depth + 1),
  );
}

function ownString(source: Record<string, unknown>, key: string): string | undefined {
  if (!Object.hasOwn(source, key)) return undefined;
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

function ownInteger(source: Record<string, unknown>, key: string): number | undefined {
  if (!Object.hasOwn(source, key)) return undefined;
  const value = source[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Rebuild an arguments object from own properties only.
 *
 * `Object.hasOwn` rather than `in`, and a null-prototype target, because the
 * program controls these keys: a forged `__proto__` or `constructor` has to
 * land as an ordinary key on an object nobody inherits from, not as a mutation
 * of a prototype the host will later read through.
 */
function rebuildArgs(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const rebuilt: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(source)) {
    const entry = source[key];
    if (!isJsonLossless(entry)) return undefined;
    Object.defineProperty(rebuilt, key, {
      value: entry,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return rebuilt;
}

/**
 * Turn one raw line into a frame, or `undefined` if it is not one.
 *
 * Returning `undefined` rather than throwing is deliberate: a malformed line is
 * the program's problem, not the host's, and the run continues so the failure
 * the model finally reads is the program's own — not a transport error that
 * tells it nothing about what to fix.
 */
export function decodeInboundFrame(line: string): InboundFrame | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > MAX_FRAME_BYTES) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const frame = parsed as Record<string, unknown>;

  switch (ownString(frame, 't')) {
    case 'hello': {
      const token = ownString(frame, 'token');
      return token ? { t: 'hello', token } : undefined;
    }
    case 'call': {
      const id = ownInteger(frame, 'id');
      const name = ownString(frame, 'name');
      const args = rebuildArgs(Object.hasOwn(frame, 'args') ? frame['args'] : {});
      if (id === undefined || !name || !args) return undefined;
      return { t: 'call', id, name, args };
    }
    case 'log': {
      const text = ownString(frame, 'text');
      return text === undefined ? undefined : { t: 'log', text };
    }
    case 'done': {
      const hasValue = Object.hasOwn(frame, 'value');
      const value = hasValue ? frame['value'] : undefined;
      if (hasValue && !isJsonLossless(value)) return undefined;
      return { t: 'done', value, hasValue };
    }
    case 'fail': {
      const kind = ownString(frame, 'kind') ?? 'exception';
      const message = ownString(frame, 'message') ?? 'the program failed without a message';
      return { t: 'fail', kind, message };
    }
    default:
      return undefined;
  }
}

/**
 * Split a byte stream into lines under a hard total budget.
 *
 * The budget is on the reader rather than on the writer because the writer is
 * the untrusted side. A program that never emits a newline would otherwise grow
 * this buffer until the *host* runs out of memory, which is a denial of service
 * against the developer's machine rather than against the program's own run.
 */
export class FrameReader {
  #buffer = '';
  #bytes = 0;
  #overflowed = false;

  constructor(private readonly maxBytes: number) {}

  get overflowed(): boolean {
    return this.#overflowed;
  }

  push(chunk: string): InboundFrame[] {
    if (this.#overflowed) return [];
    this.#bytes += Buffer.byteLength(chunk, 'utf8');
    if (this.#bytes > this.maxBytes) {
      this.#overflowed = true;
      this.#buffer = '';
      return [];
    }
    this.#buffer += chunk;
    const parts = this.#buffer.split('\n');
    this.#buffer = parts.pop() ?? '';
    const frames: InboundFrame[] = [];
    for (const part of parts) {
      const frame = decodeInboundFrame(part);
      if (frame) frames.push(frame);
    }
    return frames;
  }
}
