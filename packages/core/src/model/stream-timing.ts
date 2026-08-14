export type StreamTimingPhase =
  | 'request'
  | 'first-chunk'
  | 'first-delta'
  | 'first-paint'
  | 'completion';

export type StreamDeltaKind = 'text' | 'reasoning' | 'tool' | 'done';

/**
 * Safe latency telemetry. Deliberately excludes prompt text, response text,
 * keys, headers, URLs with userinfo, and error bodies.
 */
export interface StreamTiming {
  readonly phase: StreamTimingPhase;
  readonly elapsedMs: number;
  /** Host/provider identifier, never a credential-bearing URL. */
  readonly provider: string;
  readonly model: string;
  readonly bytes?: number;
  readonly deltaKind?: StreamDeltaKind;
}

export function redactedProviderId(endpoint: string): string {
  try {
    return new URL(endpoint).hostname || 'unknown-provider';
  } catch {
    return 'unknown-provider';
  }
}

export function streamTiming(
  input: Omit<StreamTiming, 'elapsedMs'> & { elapsedMs: number },
): StreamTiming {
  return Object.freeze({
    ...input,
    elapsedMs: Math.max(0, Math.round(input.elapsedMs)),
  });
}

