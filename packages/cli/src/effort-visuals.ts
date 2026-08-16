import { semanticWaveTone, type SemanticWaveStops } from './pulse.js';
import { color, supportsRichGlyphs, type PaletteKey } from './theme.js';

export interface EffortPulseCell {
  readonly text: string;
  readonly color: string;
}

export interface EffortVisual {
  readonly id: string;
  readonly label: string;
  /** Identity mark for the level; separate from the picker cursor/current mark. */
  readonly symbol: string;
  readonly asciiSymbol: string;
  readonly descriptor: string;
  readonly stops: SemanticWaveStops;
  readonly pattern: readonly string[];
  readonly asciiPattern: readonly string[];
  readonly cycleMs: number;
  readonly resting: string;
  readonly working: string;
}

const STANDARD_STOPS = ['brand', 'accentDim', 'accent', 'accentBright'] as const satisfies readonly PaletteKey[];

const VISUALS: Record<string, EffortVisual> = {
  default: {
    id: 'default',
    label: 'Default',
    symbol: '·',
    asciiSymbol: '.',
    descriptor: 'balanced',
    stops: STANDARD_STOPS,
    pattern: ['·', '•', '●', '•', '·'],
    asciiPattern: ['.', 'o', 'O', 'o', '.'],
    cycleMs: 960,
    resting: 'ready',
    working: 'working',
  },
  low: {
    id: 'low',
    label: 'Low',
    symbol: '·',
    asciiSymbol: '.',
    descriptor: 'light touch',
    stops: ['brand', 'accentDim'],
    pattern: ['·', '•', '·'],
    asciiPattern: ['.', 'o', '.'],
    cycleMs: 1_080,
    resting: 'light',
    working: 'light pass',
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    symbol: '◦',
    asciiSymbol: 'o',
    descriptor: 'balanced',
    stops: STANDARD_STOPS,
    pattern: ['·', '•', '●', '•', '·'],
    asciiPattern: ['.', 'o', 'O', 'o', '.'],
    cycleMs: 960,
    resting: 'ready',
    working: 'working',
  },
  high: {
    id: 'high',
    label: 'High',
    symbol: '●',
    asciiSymbol: 'O',
    descriptor: 'deep focus',
    stops: ['accentDim', 'accent', 'accentBright'],
    pattern: ['·', '•', '●', '◉', '●', '•', '·'],
    asciiPattern: ['.', 'o', 'O', '@', 'O', 'o', '.'],
    cycleMs: 840,
    resting: 'focused',
    working: 'deep focus',
  },
  xhigh: {
    id: 'xhigh',
    label: 'XHigh',
    symbol: '◉',
    asciiSymbol: '@',
    descriptor: 'maximum depth',
    stops: ['accentDim', 'accent', 'accentBright'],
    pattern: ['·', '•', '●', '◉', '◎', '◉', '●', '•', '·'],
    asciiPattern: ['.', 'o', 'O', '@', '#', '@', 'O', 'o', '.'],
    cycleMs: 760,
    resting: 'primed',
    working: 'maximum depth',
  },
  max: {
    id: 'max',
    label: 'Max',
    symbol: '◈',
    asciiSymbol: '*',
    descriptor: 'deep reasoning',
    stops: ['brand', 'accentDim', 'accent', 'accentBright'],
    pattern: ['◇', '◆', '◈', '✦', '◈', '◆', '◇'],
    asciiPattern: ['.', 'o', 'O', '*', 'O', 'o', '.'],
    cycleMs: 680,
    resting: 'max ready',
    working: 'max reasoning',
  },
  ultra: {
    id: 'ultra',
    label: 'Ultra',
    symbol: '◆',
    asciiSymbol: '#',
    descriptor: 'wide search',
    stops: ['brand', 'accentDim', 'accent', 'accentBright'],
    pattern: ['·', '✧', '✦', '✹', '✦', '✧', '·'],
    asciiPattern: ['.', '+', '*', '#', '*', '+', '.'],
    cycleMs: 600,
    resting: 'ultra ready',
    working: 'ultra reasoning',
  },
  ultracode: {
    id: 'ultracode',
    label: 'UltraCode',
    symbol: '▣',
    asciiSymbol: '#',
    descriptor: 'code synthesis',
    stops: ['brand', 'accentDim', 'accent', 'accentBright'],
    pattern: ['╺', '━', '╋', '━', '╸', '━', '╋', '━'],
    asciiPattern: ['-', '=', '#', '=', '>', '=', '#', '='],
    cycleMs: 520,
    resting: 'code ready',
    working: 'synthesizing code',
  },
  plif: {
    id: 'plif',
    label: 'PLIF',
    symbol: '✦',
    asciiSymbol: '*',
    descriptor: 'evidence mode',
    stops: ['brand', 'accentDim', 'accent', 'accentBright'],
    pattern: ['·', '◦', '✧', '✦', '✧', '◦', '·'],
    asciiPattern: ['.', 'o', '*', '*', '*', 'o', '.'],
    cycleMs: 540,
    resting: 'evidence ready',
    working: 'evidence mode',
  },
};

const FALLBACK: EffortVisual = VISUALS.default!;

export function effortVisual(effort?: string): EffortVisual {
  return VISUALS[effort ?? 'default'] ?? FALLBACK;
}

export function effortSymbol(effort?: string): string {
  const visual = effortVisual(effort);
  return supportsRichGlyphs ? visual.symbol : visual.asciiSymbol;
}

export function effortDisplay(effort: string | undefined): string {
  if (!effort) return 'Default';
  const visual = effortVisual(effort);
  return `${effortSymbol(effort)} ${visual.label}`;
}

export function effortTagline(effort: string | undefined, working: boolean): string {
  const visual = effortVisual(effort);
  return working ? visual.working : visual.resting;
}

export function effortPulseCells(
  effort: string | undefined,
  elapsedMs: number,
  active: boolean,
): readonly EffortPulseCell[] {
  const visual = effortVisual(effort);
  const pattern = supportsRichGlyphs ? visual.pattern : visual.asciiPattern;
  return pattern.map((text, index) => ({
    // Geometry is deliberately immutable. The animation is carried by the
    // travelling light; changing terminal glyphs mid-frame causes Windows
    // hosts to re-measure a row and makes the whole prompt appear to shake.
    text,
    color: active
      ? semanticWaveTone(elapsedMs, index, pattern.length, visual.stops, visual.cycleMs)
      : color('faint'),
  }));
}
