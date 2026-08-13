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
 * stay quiet, and stay legible. So the palette is almost entirely greys — four
 * of them, doing the work of hierarchy — with exactly one accent that means
 * "the agent is doing something" and three semantic colours that only appear
 * when they carry information. Nothing is coloured for decoration. If a line is
 * bright, it earned it.
 *
 * The greys are spaced far enough apart to survive a low-contrast terminal
 * theme, and the accent sits at a lightness that holds up on both black and
 * near-black backgrounds, since we do not control the user's background.
 */

/**
 * Whether the terminal can draw the fine glyphs.
 *
 * The legacy Windows console host cannot, and a mojibake prompt is worse than a
 * plain one — so this detects rather than hopes.
 *
 * The `TERM` check is load-bearing and easy to leave out. Over SSH into
 * Windows — say, from Termux on a phone — none of the local Windows markers
 * are set: no `WT_SESSION`, no `TERM_PROGRAM`, no `ConEmuANSI`. Without looking
 * at `TERM`, a perfectly capable UTF-8 terminal gets served the ASCII fallback
 * for no reason. A client that announces itself as `xterm` and friends has
 * handled box drawing for decades.
 */
const richGlyphs =
  process.platform !== 'win32' ||
  process.env['WT_SESSION'] !== undefined ||
  process.env['TERM_PROGRAM'] !== undefined ||
  process.env['ConEmuANSI'] === 'ON' ||
  /^(xterm|screen|tmux|rxvt|alacritty|kitty|foot|contour|wezterm|vt220)/.test(
    process.env['TERM'] ?? '',
  );

/** Exported so components share one answer instead of each re-deriving it. */
export const supportsRichGlyphs = richGlyphs;

/**
 * The brand blue, and the ramp derived from it.
 *
 * `#505081` is the identity colour. Measured against a near-black terminal it
 * lands at **2.59:1** contrast — below the 3:1 floor where thin monospace text
 * stops being comfortably readable, and well below 4.5:1. That is not a reason
 * to abandon it; it is a reason to give it the job it is good at.
 *
 * So the brand colour draws *structure* — panel borders, the infinity mark,
 * meter fills — where a low-contrast line reads as tasteful rather than as
 * strained. Anything that has to be **read** uses `accent`, which is the same
 * hue lifted to 6.2:1. The two are unmistakably the same colour family, so the
 * interface still reads as blue; it just does not ask anyone to squint.
 */
const defaultPalette = {
  /** Primary reading colour. Used for content, never for chrome. */
  text: '#e6e6ea',
  /** Secondary: labels, metadata, anything you skim past. */
  muted: '#8b8b95',
  /** Tertiary: borders, separators, hints. Present but never competing. */
  faint: '#55555f',
  /** Barely there. Timestamps, inactive states. */
  ghost: '#3a3a43',

  /** The brand blue, exactly. Structure only — 2.59:1 is not a text colour. */
  brand: '#505081',
  /** Brand hue lifted to 6.2:1. This is what carries agent activity and focus. */
  accent: '#8b8bd4',
  /** A brighter blue-violet used only by the travelling active-work highlight. */
  accentBright: '#b9c8ff',
  /** Between the two, at 3.9:1. Secondary emphasis and de-emphasised accents. */
  accentDim: '#6a6aa8',

  success: '#6ec48a',
  warn: '#e0a458',
  danger: '#e8695f',
  info: '#6fb3d9',
} as const;

export type PaletteKey = keyof typeof defaultPalette;
export const palette: Record<PaletteKey, string> = { ...defaultPalette };

export type SyntaxKey = 'command' | 'parameter' | 'string' | 'variable' | 'operator' | 'number' | 'comment' | 'plain';
export type EmphasisKey = 'normal' | 'important' | 'active' | 'metadata';

export const syntax: Record<SyntaxKey, PaletteKey> = {
  command: 'text', parameter: 'muted', string: 'faint', variable: 'muted',
  operator: 'ghost', number: 'muted', comment: 'ghost', plain: 'muted',
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
  /** Input prompt. */
  prompt: ['❯', '>'],
  /** A step the agent took. */
  step: ['✦', '*'],
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
  /** Right-pointing marker. */
  caret: ['▸', '>'],
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
  Object.assign(syntax, {
    command: 'text', parameter: 'muted', string: 'faint', variable: 'muted',
    operator: 'ghost', number: 'muted', comment: 'ghost', plain: 'muted',
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

/** Terminal width, clamped to something a layout can reason about. */
export function terminalWidth(): number {
  return Math.max(40, Math.min(process.stdout.columns ?? 80, 200));
}

/** Truncate to `width`, with an ellipsis that respects the glyph fallback. */
export function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 1) return value.slice(0, width);
  return value.slice(0, width - 1) + (richGlyphs ? '…' : '~');
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
