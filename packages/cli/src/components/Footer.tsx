import React from 'react';
import { Box, Text } from 'ink';

import { effortDisplay, effortTone, effortVisual } from '../effort-visuals.js';
import { displayWidth } from '../text.js';
import { color, glyph, supportsRichGlyphs, truncate } from '../theme.js';

export interface Hint {
  readonly key: string;
  readonly label: string;
}

interface FooterProps {
  readonly hints: readonly Hint[];
  readonly width: number;
  readonly status?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly effort?: string;
  readonly contextUsed?: number;
  readonly contextMax?: number;
  /** Retained for callers; temporary selectors own their keyboard hints. */
  readonly showHints?: boolean;
}

/** A compact contextual status surface shown only when it earns attention. */
export const FOOTER_HEIGHT = 3;

/**
 * Provider/model/effort/context are intentionally given one home. The labels
 * disappear as space gets tight, but the order never changes.
 */
export const Footer = React.memo(function Footer({
  hints,
  width,
  status,
  provider,
  model,
  effort,
  contextUsed = 0,
  contextMax = 0,
  showHints = false,
}: FooterProps): React.ReactElement {
  void hints;
  void status;
  void showHints;
  const innerWidth = Math.max(8, width - 4);
  const percent = contextPercent(contextUsed, contextMax);
  const meter = contextMeter(percent, 14);
  const providerLabel = provider ? providerDisplayName(provider) : 'not configured';
  const modelLabel = model?.trim() || 'model not configured';
  const effortLabel = effortDisplay(effort);
  const wide = innerWidth >= 112;
  const medium = innerWidth >= 72;
  const plain = wide
    ? `Provider ${providerLabel}  ${glyph.divider}  Model ${modelLabel}  ${glyph.divider}  Effort ${effortLabel}  ${glyph.divider}  ctx ${percent}% ${meter}`
    : medium
      ? `${providerLabel}  ${glyph.divider}  ${modelLabel}  ${glyph.divider}  ${effortLabel}  ${glyph.divider}  ctx ${percent}% ${meter}`
      : innerWidth >= 48
        ? `${modelLabel}  ${glyph.divider}  ${effortLabel}  ${glyph.divider}  ctx ${percent}% ${meter}`
        : `${truncate(modelLabel, Math.max(10, innerWidth - 17))}  ${glyph.divider}  ${effortLabel}  ${percent}%`;

  return (
    <Box
      width="100%"
      height={FOOTER_HEIGHT}
      borderStyle="round"
      borderColor={color('faint')}
      paddingX={1}
      flexShrink={0}
    >
      {displayWidth(plain) > innerWidth ? (
        <Text color={color('muted')} wrap="truncate">{truncate(plain, innerWidth)}</Text>
      ) : (
        <HudText
          wide={wide}
          provider={providerLabel}
          model={modelLabel}
          effort={effortLabel}
          effortId={effort}
          percent={percent}
          meter={meter}
        />
      )}
    </Box>
  );
}, (previous, next) => (
  previous.width === next.width &&
  previous.provider === next.provider &&
  previous.model === next.model &&
  previous.effort === next.effort &&
  previous.contextUsed === next.contextUsed &&
  previous.contextMax === next.contextMax
));

Footer.displayName = 'Footer';

function HudText({
  wide,
  provider,
  model,
  effort,
  effortId,
  percent,
  meter,
}: {
  readonly wide: boolean;
  readonly provider: string;
  readonly model: string;
  readonly effort: string;
  readonly effortId?: string;
  readonly percent: number;
  readonly meter: string;
}): React.ReactElement {
  const divider = <Text color={color('ghost')}>{`  ${glyph.divider}  `}</Text>;
  return (
    <Text wrap="truncate">
      {wide && <><Text color={color('muted')}>Provider </Text><Text color={color('accentBright')}>{provider}</Text>{divider}</>}
      {wide && <Text color={color('muted')}>Model </Text>}
      <Text color={color('accentBright')}>{model}</Text>
      {divider}
      {wide && <Text color={color('muted')}>Effort </Text>}
      <HudEffort effort={effortId} label={effort} />
      {divider}
      <Text color={color('faint')}>ctx {percent}% </Text>
      <ContextMeter meter={meter} />
    </Text>
  );
}

const ContextMeter = React.memo(function ContextMeter({ meter }: { readonly meter: string }): React.ReactElement {
  const full = supportsRichGlyphs ? '█' : '#';
  return (
    <Text>
      {Array.from(meter).map((segment, index) => (
        <Text key={`${segment}:${index}`} color={segment === full ? color('accentBright') : color('ghost')}>
          {segment}
        </Text>
      ))}
    </Text>
  );
});

ContextMeter.displayName = 'ContextMeter';

const HudEffort = React.memo(function HudEffort({
  effort,
  label,
}: {
  readonly effort?: string;
  readonly label: string;
}): React.ReactElement {
  return <Text color={color(effortTone(effort))} bold={effort !== undefined}>{label}</Text>;
});

HudEffort.displayName = 'HudEffort';

export function providerDisplayName(endpoint: string | undefined): string {
  const host = endpoint?.replace(/^https?:\/\//i, '').split('/')[0]?.toLowerCase() ?? '';
  if (!host) return 'not configured';
  if (host.includes('anthropic')) return 'Anthropic';
  if (host.includes('openrouter')) return 'OpenRouter';
  if (host.includes('opencode')) return 'OpenCode';
  if (host.includes('nvidia')) return 'NVIDIA';
  if (host.includes('openai') || host.includes('chatgpt')) return 'OpenAI';
  if (host.includes('google')) return 'Google';
  if (host.includes('deepseek')) return 'DeepSeek';
  if (host.includes('ollama')) return 'Ollama';
  if (host.includes('lmstudio')) return 'LM Studio';
  return host.split('.')[0] ?? 'Provider';
}

export function contextPercent(contextUsed: number, contextMax: number): number {
  return contextMax > 0
    ? Math.min(100, Math.round((Math.max(0, contextUsed) / contextMax) * 100))
    : 0;
}

/** A short, fixed-width meter that remains legible in Windows terminals. */
export function contextMeter(percent: number, segments = 10): string {
  const size = Math.max(8, Math.min(14, Math.floor(segments)));
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * size);
  const full = supportsRichGlyphs ? '█' : '#';
  const empty = supportsRichGlyphs ? '░' : '-';
  return full.repeat(filled) + empty.repeat(size - filled);
}

export function footerSummary({
  provider,
  model,
  effort,
  contextUsed,
  contextMax,
}: {
  readonly provider?: string;
  readonly model?: string;
  readonly effort?: string;
  readonly contextUsed: number;
  readonly contextMax: number;
}): string {
  return [
    ...(provider ? [providerDisplayName(provider)] : []),
    model?.trim() || 'model not configured',
    `effort: ${effort ? effortVisual(effort).label.toLowerCase() : 'default'}`,
    `ctx ${contextPercent(contextUsed, contextMax)}%`,
  ].join(`  ${glyph.divider}  `);
}
