import type { Message } from '../../model/provider.js';
import { estimateTokens } from '../context-budget.js';
import { techniqueIsOn } from './registry.js';
import type {
  TokenSplitConfig,
  TokenSplitProjection,
  TokenSplitTransformation,
} from './types.js';

const PROTECTED_MARKERS = /\/token-split|\b(?:goal|plan|pending|decision|decis[aã]o|objective|objetivo)\b/i;
const ERROR_MARKER = /\b(?:error|failed|failure|exception|erro|falha|stack trace|status\s*[45]\d\d)\b/i;
const PATH_MARKER = /(?:[a-z]:[\\/]|\.\.?[\\/]|\/(?:src|packages|project|workspace)\/)[^\s`'"<>]+/i;
const SECRET_MARKER = /(?:api[_-]?key|token|password|secret|private[_-]?key|authorization|credential)/i;

function estimateTextTokens(text: string): number {
  return estimateTokens([{ role: 'user', content: text }]);
}

function isProtected(message: Message, index: number, total: number): boolean {
  if (message.role === 'system') return true;
  if (index >= Math.max(0, total - 3)) return true;
  if (PROTECTED_MARKERS.test(message.content) || ERROR_MARKER.test(message.content)) return true;
  if (PATH_MARKER.test(message.content) || SECRET_MARKER.test(message.content)) return true;
  return false;
}

function recentReferences(messages: readonly Message[], index: number, lookback: number, key: string): boolean {
  return messages.slice(Math.max(0, index + 1), Math.min(messages.length, index + 1 + lookback))
    .some((message) => message.content.includes(key));
}

function clearToolResult(
  message: Message,
  headChars: number,
  tailChars: number,
): { message: Message; transformation: TokenSplitTransformation } | null {
  if (message.role !== 'tool' || message.content.length <= headChars + tailChars + 80) return null;
  const removed = message.content.length - headChars - tailChars;
  const marker = `\n… [tool result shortened by token-split; ${removed} characters omitted; raw transcript retained] …\n`;
  return {
    message: {
      ...message,
      content: `${message.content.slice(0, headChars)}${marker}${message.content.slice(-tailChars)}`,
    },
    transformation: {
      technique: 'tool-clear',
      action: 'shortened old tool result in request projection',
      tokensAffected: estimateTextTokens(message.content) - estimateTextTokens(message.content.slice(0, headChars) + marker + message.content.slice(-tailChars)),
      reversible: true,
      marker,
    },
  };
}

function pruneOldAssistant(
  message: Message,
): { message: Message; transformation: TokenSplitTransformation } | null {
  if (message.role !== 'assistant' || message.toolCalls?.length || message.content.length < 240) return null;
  const marker = '[older assistant prose hidden by token-split; raw transcript retained]';
  return {
    message: { ...message, content: marker, reasoning: undefined },
    transformation: {
      technique: 'prune-old',
      action: 'replaced safe old assistant prose in request projection',
      tokensAffected: Math.max(0, estimateTextTokens(message.content) - estimateTextTokens(marker)),
      reversible: true,
      marker,
    },
  };
}

/**
 * Build the model-facing projection without mutating the durable conversation.
 * This is intentionally conservative: if a line can carry an error, path,
 * secret, goal, decision, or protocol meaning, it stays verbatim.
 */
export function projectTokenSplitInput(
  messages: readonly Message[],
  config: TokenSplitConfig,
): TokenSplitProjection {
  const baselineTokens = estimateTokens(messages);
  if (!config.enabled) return { messages: [...messages], baselineTokens, effectiveTokens: baselineTokens, transformations: [] };

  let projected = [...messages];
  const transformations: TokenSplitTransformation[] = [];
  const toolConfig = config.techniques['tool-clear']?.config ?? {};
  const pruneConfig = config.techniques['prune-old']?.config ?? {};
  const toolAge = typeof toolConfig['ageMessages'] === 'number' ? Math.max(1, Math.floor(toolConfig['ageMessages'])) : 4;
  const lookback = typeof toolConfig['citeLookback'] === 'number' ? Math.max(1, Math.floor(toolConfig['citeLookback'])) : 3;
  const headChars = typeof toolConfig['headChars'] === 'number' ? Math.max(100, Math.floor(toolConfig['headChars'])) : 1500;
  const tailChars = typeof toolConfig['tailChars'] === 'number' ? Math.max(40, Math.floor(toolConfig['tailChars'])) : 300;
  const pruneAge = typeof pruneConfig['ageMessages'] === 'number' ? Math.max(1, Math.floor(pruneConfig['ageMessages'])) : 6;
  const pruneLookback = typeof pruneConfig['citeLookback'] === 'number' ? Math.max(1, Math.floor(pruneConfig['citeLookback'])) : 6;

  projected = projected.map((message, index, all) => {
    if (techniqueIsOn(config, 'tool-clear') && index < all.length - toolAge && !isProtected(message, index, all.length)) {
      const key = message.toolCallId ?? message.content.slice(0, 32);
      if (!recentReferences(all, index, lookback, key)) {
        const cleared = clearToolResult(message, headChars, tailChars);
        if (cleared) {
          transformations.push(cleared.transformation);
          return cleared.message;
        }
      }
    }
    if (techniqueIsOn(config, 'prune-old') && index < all.length - pruneAge && !isProtected(message, index, all.length)) {
      if (!recentReferences(all, index, pruneLookback, message.content.slice(0, 32))) {
        const pruned = pruneOldAssistant(message);
        if (pruned) {
          transformations.push(pruned.transformation);
          return pruned.message;
        }
      }
    }
    return message;
  });

  return {
    messages: projected,
    baselineTokens,
    effectiveTokens: estimateTokens(projected),
    transformations,
  };
}
