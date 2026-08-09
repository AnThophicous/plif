import type { StoredConfig, VisionCandidate } from '../model/config.js';
import { formatModelRef, parseModelRef, visionCandidates } from '../model/config.js';
import { isAutoApproveEnabled, loadGlobalConfig, saveGlobalConfig } from '../config/global.js';
import { subagentTool } from './subagent.js';
import type { SubagentOptions } from './subagent.js';
import type { Tool } from './tools.js';

export type VisionRoute =
  | { readonly kind: 'select'; readonly candidates: readonly VisionCandidate[] }
  | { readonly kind: 'saved'; readonly candidate: VisionCandidate };

/**
 * Pick only an explicitly configured image model. A stale preference is never
 * silently sent to an endpoint: it falls back to the selection menu instead.
 */
export function routeVision(config: StoredConfig): VisionRoute {
  const candidates = visionCandidates(config);
  const saved = typeof config.visionModel === 'string' ? parseModelRef(config.visionModel, {
    ...(config.provider as Record<string, never> ?? {}),
    ...(config.providers as Record<string, never> ?? {}),
  }) : undefined;
  const preferred = saved
    ? candidates.find((candidate) => candidate.provider === saved.preset && candidate.model === saved.model)
    : undefined;
  return preferred ? { kind: 'saved', candidate: preferred } : { kind: 'select', candidates };
}

export function visionModelRef(candidate: VisionCandidate): string {
  return formatModelRef(candidate.provider, candidate.model);
}

function describeCandidate(candidate: VisionCandidate): string {
  return `${candidate.provider} · ${candidate.cost} · ${candidate.baseURL || 'endpoint from provider config'}`;
}

/** Vision delegation is explicit: list candidates, choose, disclose endpoint/cost, then run. */
export function visionTools(options: SubagentOptions): readonly Tool[] {
  const child = (stored: StoredConfig) => subagentTool({ ...options, stored });

  const list: Tool = {
    parallelSafe: true,
    repeatable: true,
    spec: {
      name: 'list_vision_models',
      description: 'List configured models that explicitly declare image support. Does not start a model or spend credits.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run() {
      const config = await loadGlobalConfig();
      const candidates = visionCandidates(config);
      return {
        output: candidates.length
          ? candidates.map((candidate) => `${visionModelRef(candidate)} — ${describeCandidate(candidate)}`).join('\n')
          : 'No configured model declares modalities: ["text", "image"].',
        ok: true,
      };
    },
  };

  const inspect: Tool = {
    spec: {
      name: 'inspect_image',
      description:
        'Delegate pasted images to a configured vision model when the current model cannot inspect them. ' +
        'Shows a model picker and cost/endpoint disclosure before the first use.',
      parameters: {
        type: 'object',
        properties: { question: { type: 'string', description: 'What the vision model must determine from the image' } },
        required: ['question'],
        additionalProperties: false,
      },
    },
    async run(input, context) {
      const images = context.attachments?.filter((attachment) => attachment.kind === 'image') ?? [];
      if (images.length === 0) return { output: 'No pasted image is attached to this turn.', ok: false };

      const config = await loadGlobalConfig();
      const route = routeVision(config);
      if (route.kind === 'select' && route.candidates.length === 0) {
        return {
          output:
            'No vision model is configured. Use get_config and update_config to add an OpenAI-compatible ' +
            'provider model with modalities ["text", "image"], then ask the user before retrying.',
          ok: false,
        };
      }

      let candidate: VisionCandidate;
      if (route.kind === 'saved') {
        candidate = route.candidate;
      } else if (isAutoApproveEnabled(config)) {
        candidate = route.candidates.find((item) => item.recommended) ?? route.candidates[0]!;
      } else {
        const answer = await context.questions.ask({
          text: 'Choose a model to inspect the pasted image',
          options: [
            ...route.candidates.map((item) => ({
              value: visionModelRef(item),
              label: `${item.label}${item.recommended ? ' (Recommended Provider)' : ''}`,
              description: describeCandidate(item),
            })),
            { value: 'cancel', label: 'Cancel', description: 'Do not send the image to another provider.' },
          ],
          context: 'Custom providers receive the pasted image at their configured endpoint and may bill for tokens.',
        });
        if (!answer || answer === 'cancel') return { output: 'Vision delegation cancelled.', ok: false };
        candidate = route.candidates.find((item) => visionModelRef(item) === answer)!;
        if (!candidate) return { output: 'The selected vision model is no longer configured.', ok: false };
      }

      if (route.kind !== 'saved' && !isAutoApproveEnabled(config)) {
        const remember = await context.questions.ask({
          text: 'Use this model whenever vision is needed?',
          options: [
            { value: 'always', label: 'Always use this model', description: 'Save it and stop asking on future vision requests.' },
            { value: 'once', label: 'Use once', description: 'Send only this request and ask again next time.' },
            { value: 'cancel', label: 'Cancel', description: 'Do not send the image.' },
          ],
          context: `Model: ${visionModelRef(candidate)}\nEndpoint: ${candidate.baseURL}\nCost: ${candidate.cost}`,
        });
        if (!remember || remember === 'cancel') return { output: 'Vision delegation cancelled.', ok: false };
        if (remember === 'always') {
          await saveGlobalConfig({ ...config, visionModel: visionModelRef(candidate) });
        }
      }

      return await child(config).run(
        {
          title: `Inspect ${images.length} pasted ${images.length === 1 ? 'image' : 'images'}`,
          task: typeof input['question'] === 'string' ? input['question'] : 'Describe the pasted image accurately.',
          model: visionModelRef(candidate),
          includeAttachments: true,
        },
        context,
      );
    },
  };

  return [list, inspect];
}
