/**
 * The startup banner, as a plain string.
 *
 * ## Why this is not a React component any more
 *
 * It was, inside Ink's `<Static>`, and it duplicated. Measured, on a 60-column
 * terminal running `/help`:
 *
 *   rows=40 → 1 banner    rows=20 → 4    rows=12 → 5    rows=8 → 6
 *
 * When the rendered frame is taller than the terminal, Ink cannot do a partial
 * update, so it re-emits — and static output comes along for the ride. On a
 * phone terminal over SSH, which is where this was found, that meant two dozen
 * copies scrolling past before the prompt appeared.
 *
 * `<Static>` is the documented tool for this and it is still the wrong one: the
 * banner is not part of the live frame, it is scrollback. Writing it to stdout
 * before Ink mounts puts it outside anything Ink manages, so it physically
 * cannot be repainted, at any terminal size. Fewer moving parts, and the bug
 * class is gone rather than mitigated.
 *
 * Colour goes through chalk, which is what Ink uses underneath — so it applies
 * the same truecolor/256/16/no-colour downsampling, and honours NO_COLOR and a
 * piped stdout without this file having an opinion about any of it.
 */

import chalk from 'chalk';

import type { SandboxCapabilityReport } from '@plif/sandbox';

import { palette, shortenPath, supportsRichGlyphs, truncate } from './theme.js';

export interface BannerInput {
  readonly report: SandboxCapabilityReport;
  readonly workspace: string;
  readonly sessions: number;
  readonly version: string;
  readonly width: number;
}

/**
 * The mark: a lemniscate, rasterised rather than drawn by eye.
 *
 * The curve is `x = a·cos t / (1 + sin²t)`, `y = a·sin t·cos t / (1 + sin²t)`,
 * stroked with a disc and sampled into quadrant blocks — which is what buys the
 * two open loops and a crossing that actually reads as one strand passing over
 * the other. Hand-placed blocks at this size close the loops into slabs; the
 * previous nine-column mark was a bowtie for exactly that reason.
 *
 * Quadrant blocks give two sub-pixels per cell in each axis, and the disc is
 * stretched 2:1 in x to cancel the terminal's tall cell, so the figure keeps
 * its proportions instead of coming out squashed.
 */
export const BANNER_MARK = [
  '    ▄▄▄▄▄▄▖     ▗▄▄▄▄▄▄',
  '  ▗██▀▀▀▀▜█▙▖ ▗▟█▛▀▀▀▀██▖',
  '  ██      ▝▜███▛▘      ██',
  '  ██      ▗▟███▙▖      ██',
  '  ▝██▄▄▄▄▟█▛▘ ▝▜█▙▄▄▄▄██▘',
  '    ▀▀▀▀▀▀▘     ▝▀▀▀▀▀▀',
];

export const BANNER_MARK_ASCII = [
  '   .----.    .----.',
  '  /      \\  /      \\',
  ' |        \\/        |',
  ' |        /\\        |',
  '  \\      /  \\      /',
  "   '----'    '----'",
];

/** Vertical ramp across the mark, brightest where the strands cross. */
// Keep the large startup mark bright enough to read as the primary brand
// signal. The live dock supplies motion after Ink mounts; this scrollback mark
// must remain stable so resize cannot replay it.
const MARK_TONES = ['accentDim', 'accent', 'accentBright', 'accentBright', 'accent', 'accentDim'] as const;


const RULE = supportsRichGlyphs
  ? { top: '╭─', side: '│', bottom: '╰─' }
  : { top: '+-', side: '|', bottom: '+-' };

/**
 * Width below which the mark stops earning its space.
 *
 * Set from the art itself rather than guessed, so widening the mark cannot
 * silently start shearing it on a narrow terminal.
 */
export const DROP_ART_BELOW = Math.max(...BANNER_MARK.map((row) => row.length)) + 6;

const c = {
  brand: chalk.hex(palette.brand),
  accent: chalk.hex(palette.accent),
  accentBright: chalk.hex(palette.accentBright),
  accentDim: chalk.hex(palette.accentDim),
  muted: chalk.hex(palette.muted),
  faint: chalk.hex(palette.faint),
  ghost: chalk.hex(palette.ghost),
  danger: chalk.hex(palette.danger),
};

/**
 * Build the banner.
 *
 * Everything hangs off a left rail and simply stops on the right — no right
 * wall, no closing edge, no interior divider. That is what makes it survive a
 * resize: a layout with no right edge has nothing to shear. It also stops the
 * header looking like a copy of every other agent CLI, which mostly reach for
 * the same closed two-column card.
 */
export function renderBanner(input: BannerInput): string {
  const inner = Math.max(24, input.width - 2);
  const textWidth = Math.max(12, inner - 4);
  const showArt = inner >= DROP_ART_BELOW;
  const mark = supportsRichGlyphs ? BANNER_MARK : BANNER_MARK_ASCII;

  const lines: string[] = [];
  const rail = (body = ''): void => {
    lines.push(` ${c.brand(RULE.side)}${body}`);
  };

  lines.push(` ${c.brand(RULE.top)} ${chalk.bold(c.accent('plif'))} ${c.ghost(`v${input.version}`)}`);
  rail();

  const sessions =
    input.sessions === 0
      ? 'no sessions yet'
      : `${input.sessions} session${input.sessions === 1 ? '' : 's'} here`;

  // The mark stands on its own rather than beside the text. Six rows against
  // two lines of metadata would leave four blank rail segments propping the
  // block open, and a logo padded by emptiness reads as a layout accident.
  if (showArt) {
    mark.forEach((row, index) => {
      rail(c[MARK_TONES[index] ?? 'brand'](`  ${row}`));
    });
    rail();
  }

  for (const text of [
    c.faint(shortenPath(input.workspace, textWidth)),
    c.muted(truncate(`${sessions} · ${input.report.isolation} isolation`, textWidth)),
  ]) {
    lines.push(` ${c.brand(RULE.side)}  ${text}`);
  }

  // Sandbox gaps are not listed here — a wall of amber on every startup stops
  // being read by the second day, and unread warnings protect nobody. They live
  // in `/sandbox` in full. The exception is a machine that confines *nothing*,
  // which is not a detail to look up later.
  if (input.report.isolation === 'none') {
    rail();
    rail(c.danger(`  ${supportsRichGlyphs ? '⊘' : 'X'} no OS isolation here — /sandbox for why`));
  }

  rail();
  lines.push(
    ` ${c.brand(RULE.bottom)} ${c.ghost(truncate('/ for commands · /new for a container', inner - 3))}`,
  );

  return lines.join('\n') + '\n';
}
