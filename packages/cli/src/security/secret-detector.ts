export type SecretConfidence = 'none' | 'high';

export interface SecretSpan {
  readonly start: number;
  readonly end: number;
  readonly kind: 'sk';
}

export interface SecretDetection {
  readonly confidence: SecretConfidence;
  readonly spans: readonly SecretSpan[];
}

const SK_TOKEN = /\bsk_[A-Za-z0-9][A-Za-z0-9_-]{7,}\b/g;
const REDACTION = '[REDACTED SECRET]';

export function detectDraftSecrets(text: string): SecretDetection {
  const spans: SecretSpan[] = [];
  for (const match of text.matchAll(SK_TOKEN)) {
    const start = match.index ?? -1;
    if (start < 0 || !match[0]) continue;
    spans.push({ start, end: start + match[0].length, kind: 'sk' });
  }
  return {
    confidence: spans.length > 0 ? 'high' : 'none',
    spans,
  };
}

export function redactDetectedSecrets(text: string, detection = detectDraftSecrets(text)): string {
  if (detection.spans.length === 0) return text;
  let result = '';
  let cursor = 0;
  for (const span of detection.spans) {
    result += text.slice(cursor, span.start) + REDACTION;
    cursor = span.end;
  }
  return result + text.slice(cursor);
}

export function hasDraftSecret(text: string): boolean {
  return detectDraftSecrets(text).spans.length > 0;
}

export const SECRET_FIRST_QUESTION = 'Possible secret detected — review before sending';
export const SECRET_FIRST_CONTEXT = [
  'SECURITY WARNING — POSSIBLE SECRET DETECTED',
  '',
  'This message appears to contain a secret beginning with sk_.',
  '',
  'Do not send API keys, database credentials, passwords, tokens, or any other secrets in chat.',
  '',
  'If you continue, this secret may be stored in your local chat history and sent to your model provider. PLIF cannot unsend it, revoke it, or guarantee that it will disappear afterward.',
  '',
  'Use /env instead. PLIF stores secrets outside the conversation and lets the agent use them without exposing the value in chat.',
  '',
  'Remove the secret before continuing.',
].join('\n');
export const SECRET_FINAL_QUESTION = 'Choose an action for this draft.';
export const SECRET_FINAL_CONTEXT = [
  'FINAL WARNING — SECRET STILL DETECTED',
  '',
  'This prompt still contains a credential.',
  '',
  'If you continue, the secret may be sent to your model provider. PLIF cannot unsend it, revoke it, or guarantee that it will disappear afterward.',
].join('\n');
export const SECRET_REVIEW_VALUE = 'review';
export const SECRET_REDACT_VALUE = 'redact';
export const SECRET_SEND_VALUE = 'send';

