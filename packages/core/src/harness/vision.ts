import type { StoredConfig, VisionCandidate } from '../model/config.js';
import { formatModelRef, visionCandidates } from '../model/config.js';
import { isAutoApproveEnabled, loadGlobalConfig, saveGlobalConfig } from '../config/global.js';
import { subagentTool } from './subagent.js';
import type { SubagentOptions } from './subagent.js';
import type { Tool } from './tools.js';

export type VisionRoute =
  | { readonly kind: 'select'; readonly candidates: readonly VisionCandidate[] }
  | { readonly kind: 'saved'; readonly candidate: VisionCandidate };

/** Injectable seams keep the consent path testable without a model call or a config file. */
export interface VisionToolDependencies {
  readonly loadConfig?: () => Promise<StoredConfig>;
  readonly saveConfig?: (config: StoredConfig) => Promise<void>;
  readonly createChild?: (stored: StoredConfig) => Tool;
}

/**
 * Pick only an explicitly configured image model. A stale preference is never
 * silently sent to an endpoint: it falls back to the selection menu instead.
 */
export function routeVision(config: StoredConfig): VisionRoute {
  const candidates = visionCandidates(config);
  const preferred = typeof config.visionModel === 'string'
    ? candidates.find((candidate) => visionModelRef(candidate) === config.visionModel)
    : undefined;
  return preferred ? { kind: 'saved', candidate: preferred } : { kind: 'select', candidates };
}

export function visionModelRef(candidate: VisionCandidate): string {
  return formatModelRef(candidate.provider, candidate.model);
}

function displayEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    // Endpoints are useful provenance, but userinfo and query credentials are
    // not. Keep the host/path that identifies the recipient and redact common
    // credential-shaped query parameters before they reach a question or tool
    // result.
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (
        /(?:api[-_.]?key|auth|password|secret|token|credential|signature|session|authorization|aws[-_.]?access[-_.]?key[-_.]?id|code)/i.test(key) ||
        /^(?:key|access[-_.]?key|subscription[-_.]?key)$/i.test(key)
      ) {
        // Removing the pair hides both the value and credential vocabulary;
        // the remaining query still identifies non-sensitive routing choices.
        url.searchParams.delete(key);
      }
    }
    url.hash = '';
    return url.toString();
  } catch {
    // resolveConfig normally supplies a URL. An invalid explicit endpoint can
    // contain arbitrary configuration text, so fail closed instead of echoing
    // a value whose credential boundaries cannot be parsed reliably.
    return '[invalid endpoint redacted]';
  }
}

function costDisclosure(cost: VisionCandidate['cost']): string {
  if (cost === 'free') return 'Cost: free according to configuration; provider terms may differ.';
  if (cost === 'paid') return 'Cost: paid or usage-based; charges may apply.';
  return 'Cost: unknown; the provider may charge for this request.';
}

function describeCandidate(candidate: VisionCandidate): string {
  return [
    `Model: ${candidate.model}`,
    `Provider: ${candidate.provider}`,
    `Endpoint: ${displayEndpoint(candidate.baseURL)}`,
    costDisclosure(candidate.cost),
    'Recipient: the image and question leave Plif and may be sent to this third-party provider.',
  ].join('\n');
}

/** Vision delegation is explicit: list candidates, choose, disclose endpoint/cost, then run. */
export function visionTools(
  options: SubagentOptions,
  dependencies: VisionToolDependencies = {},
): readonly Tool[] {
  const loadConfig = dependencies.loadConfig ?? (async () => await loadGlobalConfig() as StoredConfig);
  const saveConfig = dependencies.saveConfig ?? (async (config: StoredConfig) => {
    await saveGlobalConfig(config);
  });
  const child = (stored: StoredConfig) => dependencies.createChild?.(stored) ?? subagentTool({ ...options, stored });

  const list: Tool = {
    parallelSafe: true,
    repeatable: true,
    spec: {
      name: 'list_vision_models',
      description: 'List configured models that explicitly declare image support. Does not start a model or spend credits.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run() {
      const config = await loadConfig();
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

      const config = await loadConfig();
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

      let childConfig = config;
      if (route.kind !== 'saved') {
        const remember = await context.questions.ask({
          text: `Allow ${visionModelRef(candidate)} to inspect the pasted image?`,
          options: [
            { value: 'always', label: 'Allow and remember', description: 'Save this model and stop asking on future vision requests.' },
            { value: 'once', label: 'Allow once', description: 'Send only this request and ask again next time.' },
            { value: 'cancel', label: 'Cancel', description: 'Do not send the image to another provider.' },
          ],
          context: describeCandidate(candidate),
        });
        // QuestionBroker permits free-form answers, but only the offered
        // consent choices authorize sending an image to another provider.
        // This also makes one-shot/non-interactive responders fail closed.
        if (remember !== 'always' && remember !== 'once') {
          return { output: 'Vision delegation cancelled.', ok: false };
        }
        if (remember === 'always') {
          childConfig = { ...config, visionModel: visionModelRef(candidate) };
          await saveConfig(childConfig);
        }
      }

      return await child(childConfig).run(
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
