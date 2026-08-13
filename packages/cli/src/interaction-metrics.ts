export type SubmissionKind = 'agent' | 'slash' | 'shell' | 'private-shell';

/** Classify input before starting agent-only accounting such as turns and tokens. */
export function classifySubmission(line: string): SubmissionKind {
  const trimmed = line.trim();
  if (trimmed.startsWith('!!')) return 'private-shell';
  if (trimmed.startsWith('!')) return 'shell';
  if (trimmed.startsWith('/')) return 'slash';
  return 'agent';
}

export interface CompletionMeter {
  /** Cumulative completion tokens authoritatively reported by the provider. */
  readonly reportedTokens: number;
  /** Text received since the latest authoritative usage boundary. */
  readonly pendingText: string;
  readonly tokens: number;
  readonly estimated: boolean;
}

export const initialCompletionMeter: CompletionMeter = {
  reportedTokens: 0,
  pendingText: '',
  tokens: 0,
  estimated: true,
};

export function countAgentTurns(
  events: readonly import('@plif/core').ConversationEvent[],
): number {
  return new Set(
    events
      .filter((event) => event.kind === 'user.message')
      .map((event) => event.turnId),
  ).size;
}

function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 4);
}

/** Accumulate before estimating so the count cannot depend on SSE chunk size. */
export function appendCompletionDelta(
  meter: CompletionMeter,
  delta: string,
): CompletionMeter {
  const pendingText = meter.pendingText + delta;
  return {
    ...meter,
    pendingText,
    tokens: meter.reportedTokens + estimateTokens(pendingText),
    estimated: true,
  };
}

/** Replace the live estimate when an endpoint supplies cumulative real usage. */
export function reconcileCompletionUsage(
  meter: CompletionMeter,
  completionTokens: number,
): CompletionMeter {
  if (!Number.isFinite(completionTokens) || completionTokens <= 0) return meter;
  const reportedTokens = Math.max(meter.reportedTokens, Math.floor(completionTokens));
  return {
    reportedTokens,
    pendingText: '',
    tokens: reportedTokens,
    estimated: false,
  };
}

/** A provider retry discards partial deltas but keeps earlier reported passes. */
export function discardCompletionEstimate(meter: CompletionMeter): CompletionMeter {
  return {
    reportedTokens: meter.reportedTokens,
    pendingText: '',
    tokens: meter.reportedTokens,
    estimated: meter.reportedTokens === 0,
  };
}
