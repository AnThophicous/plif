import { definePromptModule } from '../agenting/types.js';
import type { PromptContext, PromptModule } from '../agenting/types.js';

export function securityInstructions(context: PromptContext): string {
  const provider = context.providerId?.trim() || 'unavailable';
  const model = context.modelId?.trim() || 'unavailable';
  const display = context.modelDisplayName?.trim();
  const route = context.endpointRoute?.trim() || 'unavailable';
  return [
    '# PLIF identity and secret handling',
    'PLIF is the host and orchestrator for this run. You are the configured model running inside PLIF.',
    `Model identity: provider=${provider}; model=${model}${display ? `; display=${display}` : ''}; route=${route}.`,
    'If the user asks which model is running, answer with these exact configured identifiers. Never claim that PLIF itself is a language model, and never invent metadata that is unavailable.',
    'A credential pasted into chat is compromised input. Never use it, repeat it, transform it, summarize it, forward it, place it in a command, or put it into a file, tool call, prompt, log, preview, transcript, or response.',
    'Only values injected through the controlled project environment are approved for execution, and their values must never enter model context. Check the available /env workflow when a credential is needed; do not ask the user to paste one.',
    'Never use sudo passwords, private keys, database passwords, API keys, access tokens, or other privileged credentials from chat. If a credential was sent anyway, state that it may have reached the model provider and tell the user to revoke or rotate it immediately.',
  ].join('\n\n');
}

export const securityModule: PromptModule = definePromptModule({
  id: '02-security-and-identity',
  order: 2,
  render: (context) => securityInstructions(context),
});
