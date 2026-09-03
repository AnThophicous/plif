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
 * stay quiet, and stay legible. The ramp is therefore semantic: borders,
 * important details, highlighted text, default text, and active thinking each
 * have a clear role. Nothing is coloured for decoration. If a line is bright,
 * it earned it.
 *
 * There are three families and only three: a near-white ink, a spaced neutral
 * grey hierarchy, and the pink. Everything on screen is one of them or a step
 * between two — which is what lets a gradient run from grey through white into
 * pink and still read as one surface.
 *
 * The greys are spaced far enough apart to survive a low-contrast terminal
 * theme, and the pink sits at a lightness that holds up on both black and
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
 * The Plif neutral palette with one semantic pink signal. The gray hierarchy
 * remains the atmosphere; pink appears only when the UI is active, focused,
 * selected, or carrying the PLIF signature.
 */
const defaultPalette = {
  /**
   * Dominant reading colour and structural ink.
   *
   * A near-white carrying the faintest pink-grey bias. It was a blue lavender
   * (#CDD6F4), which put the most-used colour on the screen in a different
   * family from the identity: every line of prose pulled cool while the accent
   * pulled warm, and the two never read as one palette.
   */
  text: '#EDEAEC',
  /** The full-bleed shell surface that holds the current Plif frame. */
  panel: '#303030',
  /** Quiet filled surface for the developer's own message row. */
  surface: '#2C2D2E',
  /*
    The grey hierarchy.

    Four steps that have to stay tellable apart at a glance, because they are
    what carries structure once colour is spent on meaning. They used to sit
    within ten units of each other (#89959E / #7C848A / #6F767C), which is a
    difference a terminal renders as "slightly different grey" and a reader
    renders as "one grey" — so a hint, a separator and a piece of metadata all
    weighed the same. These are spaced, and neutral rather than blue.
  */
  /** Secondary text: readable, but quieter than the main ink. */
  muted: '#A9A2A7',
  /** Tertiary: borders, separators, hints. Present but never competing. */
  faint: '#857E83',
  /** Quiet metadata and inactive states. */
  ghost: '#655F63',

  /** Border and structural identity colour. */
  brand: '#C9BFC5',
  /** Thinking and active-work colour. The signature pink. */
  accent: '#e8a8c9',
  /** Bright highlight used by the travelling glow. */
  accentBright: '#f4c4dc',
  /** Important details and de-emphasised accents. */
  accentDim: '#b87e9c',

  /*
    The pink ramp, in order: accentDim → accentStrong → accent → accentBright
    → accentPastel. It is walked as a gradient by the glow and by every
    activity glyph, so it has to be monotonic. `accentStrong` used to be the
    exact same value as `accentDim`, which put a dead step in the middle of
    every gradient in the app — the wave visibly stalled a third of the way
    through its travel.
  */
  accentStrong: '#d693b4',
  accentPastel: '#fbe0ee',
  accentTint: '#4a3542',
  accentBorder: '#7a5568',

  /** Legacy names retained for user themes; values now follow PLIF pink. */
  goldDim: '#7a5568',
  goldBase: '#e8a8c9',
  gold: '#f4c4dc',
  goldBright: '#fbe0ee',
  warmIvory: '#fbe0ee',

  success: '#8FB3A6',
  warn: '#BDAA82',
  danger: '#C58F99',
  /** Neutral, so a piece of information never reads as a different family. */
  info: '#B7B0B5',
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
 *
 * The ramp is one continuous warming: at Low the structural colour is a plain
 * grey, and each level leans a little further toward the identity pink until
 * PLIF, which arrives in the family outright. So depth is legible before a
 * single word is read, and the whole ladder is grey → white → pink rather than
 * eight arbitrary swatches.
 *
 * It used to ramp through blue-greys, which is the one family the accent does
 * not belong to: raising the effort tinted the frame *away* from the identity.
 */
export const effortPalette: Readonly<Record<string, Partial<Record<PaletteKey, string>>>> = {
  low: {
    brand: '#8A8489', info: '#A39CA1',
  },
  medium: {
    brand: '#969095', info: '#ADA6AB',
  },
  high: {
    brand: '#A29BA0', info: '#B7B0B5',
  },
  xhigh: {
    brand: '#AEA6AC', info: '#C1BABF',
  },
  max: {
    brand: '#BAB0B8', info: '#CBC3C8',
  },
  ultra: {
    brand: '#C6BAC3', info: '#D5CBD1',
  },
  ultracode: {
    brand: '#D0C2CC', info: '#DFD3DA',
  },
  plif: {
    brand: '#DCC8D6', info: '#EDEAEC',
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
  /**
   * Live and healthy.
   *
   * Paired with `pending` and `failed` so a three-state indicator - the MCP
   * screen's server column - is still readable with colour off, which is how
   * it will be read in a pipe, a screenshot, or by anyone who cannot separate
   * the green from the amber.
   */
  live: ['●', '*'],
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
 * The one visual contract for binary settings across the CLI.
 *
 * Keep the marker free of words so a setting can be understood at a glance;
 * the surrounding label explains what is being switched. The semantic tone
 * is deliberately shared by pickers and notices instead of being re-created
 * by each command.
 */
export type BinaryState = 'on' | 'off';
export function binaryStateIndicator(state: BinaryState): {
  readonly icon: string;
  readonly tone: 'success' | 'danger';
} {
  return state === 'on'
    ? { icon: glyph.done, tone: 'success' }
    : { icon: glyph.failed, tone: 'danger' };
}

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
  /**
   * Left and right inset of the whole live surface.
   *
   * This was 4, which put every transcript row five columns in once the
   * timeline's own gutter was added, and made the content read as floating in
   * the middle of the terminal instead of belonging to its left edge. One
   * column keeps the text off the very border without the drift.
   */
  surfacePadX: 1,
  surfacePadY: 1,
  /** Width of the status column that `[done]`-style tags right-align into. */
  statusColumn: 12,
  /** Below this terminal width, drop right-aligned metadata rather than wrap. */
  narrowWidth: 72,
  /**
   * Retained for user themes that set it; no longer trims the transcript.
   *
   * It used to cut the timeline to its newest 200 entries, which is why a long
   * session appeared to lose its earlier messages. The transcript is the record
   * of the session and is now rendered whole, with Slate scrolling what does
   * not fit.
   */
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
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  // Seconds are rounded, so 59.6s has to carry into the minute rather than
  // print as `0m60s`. Anything past an hour rolls over too: a rate limit that
  // resets in four hours used to read `239m60s`.
  const totalSeconds = Math.round(ms / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m${seconds.toString().padStart(2, '0')}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return `${hours}h${minutes.toString().padStart(2, '0')}m`;
  return `${Math.floor(hours / 24)}d${(hours % 24).toString().padStart(2, '0')}h`;
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
