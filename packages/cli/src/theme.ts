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
 * stay quiet, and stay legible. The gold ramp is therefore semantic: borders,
 * important details, highlighted text, default text, and active thinking each
 * have a clear role. Nothing is coloured for decoration. If a line is bright,
 * it earned it.
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
 * The Plif gold palette, and the ramp derived from it.
 *
 * The controlled-test palette keeps the existing semantic roles intact while
 * replacing the default blue identity with the requested gold ramp:
 *
 * - `#CC9A3A` for borders and structural chrome;
 * - `#C68E17` for important details;
 * - `#E8C170` for highlighted secondary text and tables;
 * - `#FFD700` for default readable text;
 * - `#E0A526` for thinking and active work.
 *
 * The wave animation still travels through semantic stops. Only the colours
 * changed; cell geometry, glow timing, and effort effects remain untouched.
 */
const defaultPalette = {
  /** Primary reading colour. Used for content, never for chrome. */
  text: '#FFD700',
  /** The full-bleed shell surface that holds the current Plif frame. */
  panel: '#191b20',
  /** Quiet filled surface for the developer's own message row. */
  surface: '#25282f',
  /** Secondary and highlighted text, including compact tables. */
  muted: '#E8C170',
  /** Tertiary: borders, separators, hints. Present but never competing. */
  faint: '#CC9A3A',
  /** Barely there. Timestamps, inactive states. */
  ghost: '#6E541D',

  /** Border and structural identity colour. */
  brand: '#CC9A3A',
  /** Thinking and active-work colour. */
  accent: '#E0A526',
  /** Bright highlight used by the travelling glow. */
  accentBright: '#E8C170',
  /** Important details and de-emphasised accents. */
  accentDim: '#C68E17',

  success: '#6ec48a',
  warn: '#C68E17',
  danger: '#e8695f',
  info: '#E8C170',
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
  addBackground: '#12291b',
  removeBackground: '#33161a',
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
  prompt: ['❯', '>'],
  /** A step the agent took. */
  step: ['•', '*'],
  /** An agent or task row. */
  task: ['∷', '::'],
  /** Currently running. */
  active: ['●', '*'],
  /** Queued, not started. */
  pending: ['○', 'o'],
  /** Finished cleanly. */
  done: ['✓', 'v'],
  /** Failed. */
  failed: ['✗', 'x'],
  /** Blocked, waiting on a human. */
  waiting: ['◆', '?'],
  /** Vertical separator in the hint bar. */
  divider: ['│', '|'],
  /** Leading rail on continuation lines. */
  rail: ['│', '|'],
  /** Points at a nested detail. */
  branch: ['└', '`'],
  /**
   * Joins a compacted batch line to the one detail worth naming under it.
   *
   * Rounded rather than square, because it hangs off a summary rather than
   * closing a list: `⎿` reads as "and specifically", `└` reads as "the last of".
   */
  hook: ['⎿', '`-'],
  /** Right-pointing marker. */
  caret: ['▸', '>'],
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
  /** A tool call that ran. Filled, because it is a thing that happened. */
  tool: ['⏺', 'o'],
  /**
   * Marks the gutter of something the agent said, as opposed to did.
   *
   * A text circle, deliberately not U+23FA. That one carries `Emoji=Yes`, and
   * on Windows the text font has no glyph for it, so fallback draws it from the
   * emoji font — coloured, and two cells wide where the layout budgeted one.
   */
  speak: ['●', '*'],
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

glyph.tool = richGlyphs ? '•' : '*';
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
  surfacePadX: 1,
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
    addBackground: '#12291b', removeBackground: '#33161a',
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
  const accents: Record<string, Partial<Record<PaletteKey, string>>> = {
    max: {
      text: '#eadbff', muted: '#c49aff', faint: '#6337a8', ghost: '#432775',
      brand: '#6337a8', accent: '#c49aff', accentBright: '#eadbff', accentDim: '#9568d0',
      info: '#c49aff', warn: '#9568d0',
    },
    ultra: {
      text: '#fff0b0', muted: '#f2ca68', faint: '#96711f', ghost: '#604711',
      brand: '#96711f', accent: '#f2ca68', accentBright: '#fff0b0', accentDim: '#c19a3c',
      info: '#f2ca68', warn: '#c19a3c',
    },
    ultracode: {
      text: '#ffd0ac', muted: '#ff9a5c', faint: '#a64b1d', ghost: '#6b3014',
      brand: '#a64b1d', accent: '#ff9a5c', accentBright: '#ffd0ac', accentDim: '#d66d37',
      info: '#ff9a5c', warn: '#d66d37',
    },
  };
  Object.assign(palette, activeThemePalette, accents[effort ?? ''] ?? {});
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
