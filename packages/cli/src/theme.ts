/**
 * The visual system.
 *
 * Everything the CLI draws pulls its colour and its glyph from here, so the
 * interface reads as one surface rather than as a pile of independently styled
 * components. Change a value here and the whole app moves with it.
 *
 * ## The idea
 *
 * A terminal that a developer sits in for hours has to do two things at once:
 * stay quiet, and stay legible. The cold blue-grey ramp is therefore semantic:
 * borders, important details, highlighted text, default text, and active
 * thinking each have a clear role. Nothing is coloured for decoration. If a
 * line is bright, it earned it.
 *
 * The greys are spaced far enough apart to survive a low-contrast terminal
 * theme, and the accent sits at a lightness that holds up on both black and
 * near-black backgrounds, since we do not control the user's background.
 */
import { clusterLength, displayWidth } from './text.js';


/**
 * Whether the terminal should draw the real interface glyphs.
 *
 * Node writes Unicode correctly to current Windows console hosts, including a
 * plain `cmd.exe`. Inferring capability from Windows Terminal environment
 * markers turned their absence into an ASCII UI even when the console rendered
 * box drawing perfectly. Unicode is the default everywhere; `PLIF_ASCII=1` is
 * the explicit escape hatch for a genuinely limited remote terminal.
 */
const richGlyphs = process.env['PLIF_ASCII'] !== '1';

/** Exported so components share one answer instead of each re-deriving it. */
export const supportsRichGlyphs = richGlyphs;

/**
 * The Plif cold palette. The two anchors are deliberately few:
 * `#A2ADB5` is the primary ink and `#CDD6F4` is the reserved accent.
 * Everything else is a quiet derived role or a genuinely semantic state —
 * with one exception: the champagne `gold` pair exists so the PLIF signature
 * can carry a single warm note on an otherwise cold surface.
 */
const defaultPalette = {
  /** Dominant reading colour and structural ink. */
  text: '#A2ADB5',
  /** The full-bleed shell surface that holds the current Plif frame. */
  panel: '#303030',
  /** Quiet filled surface for the developer's own message row. */
  surface: '#2C2D2E',
  /** Secondary text: readable, but quieter than the main ink. */
  muted: '#89959E',
  /** Tertiary: borders, separators, hints. Present but never competing. */
  faint: '#7C848A',
  /** Quiet metadata and inactive states. */
  ghost: '#6F767C',

  /** Border and structural identity colour. */
  brand: '#AAB8CC',
  /** Thinking and active-work colour. */
  accent: '#B7C4D8',
  /** Bright highlight used by the travelling glow. */
  accentBright: '#CDD6F4',
  /** Important details and de-emphasised accents. */
  accentDim: '#84919D',

  /**
   * Warm champagne gold, reserved for the PLIF signature.
   *
   * The interface stays cold; this is the one warm note, and it belongs to
   * identity moments only — the `✦ PLIF` mark, the signature effort, the
   * travelling glow's warm flash. It is deliberately off-gold: quiet enough
   * to sit beside `#A2ADB5` without the screen reading as yellow.
   */
  /** Dark gold / transition anchor. */
  goldDim: '#A99159',
  /** Base champagne gold. */
  goldBase: '#D6B968',
  /** Primary PLIF champagne. */
  gold: '#E2C675',
  /** Bright champagne used at the centre of a controlled emphasis. */
  goldBright: '#ECD894',
  /** Warm ivory at the centre of the PLIF light concentration. */
  warmIvory: '#F2E3B1',

  success: '#8FB3A6',
  warn: '#BDAA82',
  danger: '#C58F99',
  info: '#A2ADB5',
} as const;

export type PaletteKey = keyof typeof defaultPalette;
export const palette: Record<PaletteKey, string> = { ...defaultPalette };
let activeThemePalette: Record<PaletteKey, string> = { ...defaultPalette };

export type SyntaxKey =
  | 'command'
  | 'parameter'
  | 'keyword'
  | 'function'
  | 'type'
  | 'property'
  | 'string'
  | 'variable'
  | 'operator'
  | 'number'
  | 'comment'
  | 'plain';
export type EmphasisKey = 'normal' | 'important' | 'active' | 'metadata';

export const syntax: Record<SyntaxKey, PaletteKey> = {
  command: 'text', parameter: 'muted', keyword: 'accentDim', function: 'info',
  type: 'accent', property: 'muted', string: 'faint', variable: 'text',
  operator: 'ghost', number: 'warn', comment: 'ghost', plain: 'muted',
};

export const borders = { panel: 'faint' as PaletteKey, focus: 'muted' as PaletteKey, danger: 'danger' as PaletteKey };
export const diffStyle = {
  addBackground: '#33423D',
  removeBackground: '#493B40',
  addMarker: 'success' as PaletteKey,
  removeMarker: 'danger' as PaletteKey,
};
export const emphasis: Record<EmphasisKey, { tone: PaletteKey; bold: boolean }> = {
  normal: { tone: 'muted', bold: false },
  important: { tone: 'text', bold: true },
  active: { tone: 'text', bold: true },
  metadata: { tone: 'ghost', bold: false },
};

/**
 * Effort changes the active signal, not the legibility of the whole terminal.
 * The ramp stays inside the Plif blue-grey family; PLIF reaches the primary
 * anchor and, through the stops in `effort-visuals.ts`, the one warm flash the
 * signature is allowed.
 */
export const effortPalette: Readonly<Record<string, Partial<Record<PaletteKey, string>>>> = {
  low: {
    brand: '#7F8B95', accentDim: '#71808A', accent: '#87949E', accentBright: '#A2ADB5', info: '#A2ADB5',
  },
  medium: {
    brand: '#8E9BA6', accentDim: '#7F8C97', accent: '#98A5B1', accentBright: '#B0BCCB', info: '#A2ADB5',
  },
  high: {
    brand: '#9EACBC', accentDim: '#8C9AAA', accent: '#A8B5C7', accentBright: '#BDC8DB', info: '#AEB9C8',
  },
  xhigh: {
    brand: '#AAB8CC', accentDim: '#98A6B8', accent: '#B4C0D2', accentBright: '#C5CEE1', info: '#B7C3D4',
  },
  max: {
    brand: '#AFBBD0', accentDim: '#9DAABE', accent: '#B9C4D7', accentBright: '#C8D1E3', info: '#BAC5D7',
  },
  ultra: {
    brand: '#B5C1D6', accentDim: '#A3B0C4', accent: '#BECADE', accentBright: '#CAD3E7', info: '#C0CBDF',
  },
  ultracode: {
    brand: '#B8C4D9', accentDim: '#A5B2C7', accent: '#C1CCE0', accentBright: '#CBD4E8', info: '#C3CEE1',
  },
  plif: {
    brand: '#C0CBE3', accentDim: '#AAB8D0', accent: '#C6D1E9', accentBright: '#CDD6F4', info: '#CDD6F4',
  },
};

/**
 * Always hand back the hex value.
 *
 * Chalk, underneath Ink, already detects what the terminal supports and
 * downsamples a hex colour to 256 or 16 colours — or strips it entirely when
 * output is piped. Gating on `COLORTERM` here, as an earlier version did, threw
 * that away: `COLORTERM` is not forwarded over SSH, so connecting from a phone
 * collapsed a carefully spaced four-grey hierarchy into `gray, gray, gray`.
 *
 * Letting chalk decide gives the closest available approximation on every
 * terminal instead of the crudest one on several.
 */
export function color(key: PaletteKey): string {
  return palette[key];
}

export function syntaxColor(key: SyntaxKey): string {
  return color(syntax[key]);
}

/**
 * Glyphs, with an ASCII twin for each.
 *
 * The rich set is lifted from the visual language of modern agent CLIs: a
 * hollow bullet for pending work, a filled one for active, a chevron for input.
 * The point of each pairing is that the ASCII version carries the *same*
 * meaning, so a user on a legacy console loses polish but never information.
 */
const glyphPairs = {
  /** The Plif mark. */
  infinity: ['oo', 'oo'],
  /** Input prompt. */
  prompt: ['›', '>'],
  /** A step the agent took. */
  step: ['·', '.'],
  /** An agent or task row. */
  task: ['∷', '::'],
  /** Currently running. */
  active: ['…', '...'],
  /** Queued, not started. */
  pending: ['○', 'o'],
  /** Finished cleanly. */
  done: ['✓', 'v'],
  /** Failed. */
  failed: ['×', 'x'],
  /** Blocked, waiting on a human. */
  waiting: ['◆', '?'],
  /** Vertical separator in the hint bar. */
  divider: ['│', '|'],
  /** Leading rail on continuation lines. */
  rail: ['│', '|'],
  /** Points at a nested detail. */
  branch: ['↳', '`->'],
  /**
   * Joins a compacted batch line to the one detail worth naming under it.
   *
   * Rounded rather than square, because it hangs off a summary rather than
   * closing a list: `⎿` reads as "and specifically", `└` reads as "the last of".
   */
  hook: ['⎿', '`-'],
  /** Right-pointing marker. */
  caret: ['›', '>'],
  /** Disclosure marker used by compact trays and expandable surfaces. */
  disclosure: ['▾', 'v'],
  /** Meter fill and track. */
  meterFull: ['█', '#'],
  meterEmpty: ['░', '-'],
  /** Container / sandbox indicator. */
  container: ['▣', '#'],
  /** Denotes a locked or denied thing. */
  locked: ['⊘', 'X'],
  /** Filter or search affordance. */
  search: ['⌕', '/'],
  /** Marks text scrolled out of view at the edge of a field. */
  clip: ['‹', '<'],
  /** Leads the token counter on the thinking line. */
  tokens: ['↓', 'v'],
  /** An activity/detail row attached to the agent's work. */
  tool: ['↳', '->'],
  /**
   * Marks the gutter of something the agent said, as opposed to did.
   *
   * A text circle, deliberately not U+23FA. That one carries `Emoji=Yes`, and
   * on Windows the text font has no glyph for it, so fallback draws it from the
   * emoji font — coloured, and two cells wide where the layout budgeted one.
   */
  speak: ['✦', '*'],
  /** The warm identity mark used by PLIF, header and thinking rows. */
  sparkle: ['✦', '*'],
  /** A quieter phase of the same identity mark. */
  subtleSparkle: ['✧', '*'],
  shell: ['$', '$'],
  read: ['R', 'R'],
  list: ['L', 'L'],
  edit: ['±', '+/-'],
  network: ['⌕', '/'],
  agent: ['∷', '::'],
  retry: ['↻', '~'],
  question: ['?', '?'],
  /** Added line in a diff. */
  plus: ['+', '+'],
  /** Removed line in a diff. */
  minus: ['-', '-'],
} as const;

export type GlyphKey = keyof typeof glyphPairs;

export const glyph: Record<GlyphKey, string> = Object.fromEntries(
  Object.entries(glyphPairs).map(([key, [rich, plain]]) => [key, richGlyphs ? rich : plain]),
) as Record<GlyphKey, string>;

const defaultGlyph = { ...glyph };

/**
 * Layout constants.
 *
 * Two of these carry most of the visual identity. `gutter` is the left margin
 * every line shares, which is what makes the timeline read as a column rather
 * than as text jammed against the terminal edge. `boxPadX` is the breathing
 * room inside the prompt — the single biggest contributor to the interface
 * feeling calm instead of cramped.
 */
const defaultLayout = {
  gutter: 1,
  boxPadX: 1,
  surfacePadX: 4,
  surfacePadY: 1,
  /** Width of the status column that `[done]`-style tags right-align into. */
  statusColumn: 12,
  /** Below this terminal width, drop right-aligned metadata rather than wrap. */
  narrowWidth: 72,
  /** Timeline entries kept on screen; older ones scroll out of the render. */
  maxTimelineRows: 200,
} as const;

export type LayoutKey = keyof typeof defaultLayout;
export const layout: Record<LayoutKey, number> = { ...defaultLayout };

export interface ThemeOverrides {
  readonly palette?: Partial<Record<PaletteKey, string>>;
  readonly syntax?: Partial<Record<SyntaxKey, PaletteKey>>;
  readonly borders?: Partial<Record<keyof typeof borders, PaletteKey>>;
  readonly diff?: Partial<typeof diffStyle>;
  readonly emphasis?: Partial<Record<EmphasisKey, Partial<{ tone: PaletteKey; bold: boolean }>>>;
  readonly glyphs?: Partial<Record<GlyphKey, string>>;
  readonly layout?: Partial<Record<LayoutKey, number>>;
}

export function applyTheme(theme: ThemeOverrides = {}): void {
  Object.assign(palette, defaultPalette, theme.palette ?? {});
  activeThemePalette = { ...palette };
  Object.assign(syntax, {
    command: 'text', parameter: 'muted', keyword: 'accentDim', function: 'info',
    type: 'accent', property: 'muted', string: 'faint', variable: 'text',
    operator: 'ghost', number: 'warn', comment: 'ghost', plain: 'muted',
  }, theme.syntax ?? {});
  Object.assign(borders, { panel: 'faint', focus: 'muted', danger: 'danger' }, theme.borders ?? {});
  Object.assign(diffStyle, {
    addBackground: '#33423D', removeBackground: '#493B40',
    addMarker: 'success', removeMarker: 'danger',
  }, theme.diff ?? {});
  const defaults = {
    normal: { tone: 'muted' as PaletteKey, bold: false },
    important: { tone: 'text' as PaletteKey, bold: true },
    active: { tone: 'text' as PaletteKey, bold: true },
    metadata: { tone: 'ghost' as PaletteKey, bold: false },
  };
  for (const key of Object.keys(defaults) as EmphasisKey[]) {
    emphasis[key] = { ...defaults[key], ...(theme.emphasis?.[key] ?? {}) };
  }
  Object.assign(glyph, defaultGlyph, theme.glyphs ?? {});
  Object.assign(layout, defaultLayout, theme.layout ?? {});
}

/** Overlay the effort accent without destroying the user's selected theme. */
export function applyEffortPalette(effort?: string): void {
  Object.assign(palette, activeThemePalette);
  for (const [key, value] of Object.entries(effortPalette[effort ?? ''] ?? {})) {
    const paletteKey = key as PaletteKey;
    // A user theme owns an explicit colour. Effort only fills the default
    // role, so selecting PLIF never silently erases a user's theme.
    if (activeThemePalette[paletteKey] === defaultPalette[paletteKey]) {
      palette[paletteKey] = value!;
    }
  }
}

/** Terminal width, clamped to something a layout can reason about. */
export function terminalWidth(): number {
  return Math.max(40, Math.min(process.stdout.columns ?? 80, 200));
}

/** Truncate to `width`, with an ellipsis that respects the glyph fallback. */
export function truncate(value: string, width: number): string {
  const available = Math.max(0, Math.floor(width));
  if (displayWidth(value) <= available) return value;
  if (available === 0) return '';
  const marker = richGlyphs ? '…' : '~';
  const target = Math.max(0, available - displayWidth(marker));
  let used = 0;
  let at = 0;
  while (at < value.length) {
    const length = clusterLength(value, at) || 1;
    const cluster = value.slice(at, at + length);
    const cells = displayWidth(cluster);
    if (used + cells > target) break;
    used += cells;
    at += length;
  }
  return value.slice(0, at) + marker;
}

/**
 * Shorten a path from the left, keeping the tail.
 *
 * The end of a path is what identifies it; the beginning is almost always
 * `C:\Users\<name>\Documents\...` and tells the developer nothing they do not
 * already know.
 */
export function shortenPath(value: string, width: number): string {
  const home = process.env['USERPROFILE'] ?? process.env['HOME'] ?? '';
  let display = value;
  if (home && display.toLowerCase().startsWith(home.toLowerCase())) {
    display = '~' + display.slice(home.length);
  }
  display = display.replace(/\\/g, '/');
  if (display.length <= width) return display;

  const parts = display.split('/');
  while (parts.length > 2 && parts.join('/').length > width) parts.shift();
  const shortened = (richGlyphs ? '…/' : '.../') + parts.join('/');
  return shortened.length <= width ? shortened : truncate(display, width);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)}${units[unit]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`;
}

/** Human-friendly duration used by the cycle separators in the timeline. */
export function formatWorkedDuration(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  if (safeMs < 1000) return `${safeMs}ms`;
  const tenths = Math.round(safeMs / 100);
  if (tenths < 600) return `${(tenths / 10).toFixed(1)}s`;
  const totalSeconds = Math.round(tenths / 10);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

/** Width-aware rule that separates one model/tool cycle from the next. */
export function workedSeparator(durationMs: number, width: number): string {
  const line = supportsRichGlyphs ? '─' : '-';
  const label = `Worked for ${formatWorkedDuration(durationMs)}`;
  return `${line} ${label} ${line.repeat(Math.max(1, width - label.length - 3))}`;
}

export function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}
