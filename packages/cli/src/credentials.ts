export type CredentialChoice = 'save' | 'session' | 'cancel';

export interface CredentialPrompt {
  readonly text: string;
  readonly context: string;
  readonly secret: true;
}

export interface CredentialProbeFailure {
  readonly title: string;
  readonly subtitle: string;
}

export function credentialProbeFailure(
  provider: string,
  model: string,
  detail: string,
): CredentialProbeFailure {
  const authenticationFailure = /api key|credential|unauthori[sz]ed|forbidden|\b401\b|\b403\b/i.test(detail);
  return authenticationFailure
    ? {
        title: `API key rejected for ${provider} / ${model}`,
        subtitle: 'Nothing was saved. Check the key for this provider and try again.',
      }
    : {
        title: `Could not verify API key for ${provider} / ${model}`,
        subtitle: 'Nothing was saved. Check the provider endpoint and try again.',
      };
}

export function credentialChoice(value: string | null): CredentialChoice {
  return value === 'save' || value === 'session' || value === 'cancel' ? value : 'cancel';
}

export function credentialPrompt(
  provider: string,
  model: string,
  keyEnv: string | undefined,
): CredentialPrompt {
  return {
    text: `API key · ${provider} / ${model}`,
    secret: true,
    context: [
      'The key is masked while you type and never enters the transcript.',
      `Save location: ~/.plif/config.toml${keyEnv ? ` · environment: ${keyEnv}` : ''}`,
      'After entry, choose save, session only, or cancel.',
    ].join('\n'),
  };
}

export const CREDENTIAL_USE_OPTIONS = [
  {
    value: 'save',
    label: 'Save to personal config',
    description: 'Write it to ~/.plif/config.toml with user-only file permissions.',
  },
  {
    value: 'session',
    label: 'Use for this session',
    description: 'Keep it in memory only; it will not be written to disk.',
  },
  {
    value: 'cancel',
    label: 'Cancel',
    description: 'Leave the current model and session unchanged.',
  },
] as const;
