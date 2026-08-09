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

const MARK = ['▗▛▀▜▄▛▀▜▖', '█▌ ▘█▝ ▐█', '▝▜█▛ ▜█▛▘'];
const MARK_ASCII = [' __   __ ', '(  ) (  )', ' \\/   \\/ '];

const RULE = supportsRichGlyphs
  ? { top: '╭─', side: '│', bottom: '╰─' }
  : { top: '+-', side: '|', bottom: '+-' };

/** Widths below which pieces of the banner stop earning their space. */
const DROP_ART_BELOW = 52;

const c = {
  brand: chalk.hex(palette.brand),
  accent: chalk.hex(palette.accent),
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
  const mark = supportsRichGlyphs ? MARK : MARK_ASCII;

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

  const rows: (string | null)[] = [
    c.faint(shortenPath(input.workspace, textWidth)),
    c.muted(truncate(`${sessions} · ${input.report.isolation} isolation`, textWidth)),
    null,
  ];

  rows.forEach((text, index) => {
    // With the art hidden there is nothing to hold a text-less row open, and it
    // would render as a blank rail segment padding the block for no reason.
    if (!showArt && text === null) return;
    const art = showArt ? c[index === 1 ? 'accent' : 'brand'](`  ${mark[index]}`) : '';
    const gap = text === null ? '' : showArt ? '   ' : '  ';
    lines.push(` ${c.brand(RULE.side)}${art}${gap}${text ?? ''}`);
  });

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
