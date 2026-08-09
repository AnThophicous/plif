import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Render a release as one embeddable SVG.
 *
 * GitHub shows a markdown image through its camo proxy, so the card has to be
 * self-contained: no external font, no external stylesheet, no script. It also
 * has to read on both GitHub themes, which is why it paints its own opaque
 * surface instead of inheriting the page background.
 *
 * Usage: node scripts/changelog-card.mjs
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const palette = {
  surface: '#12121a',
  surfaceTop: '#191926',
  edge: '#2a2a38',
  brand: '#505081',
  accent: '#8b8bd4',
  text: '#e8e8f0',
  muted: '#8b8b95',
  faint: '#55555f',
  added: '#6ec48a',
  removed: '#e8695f',
  warn: '#e0a458',
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace";

const release = {
  from: '0.1.0',
  to: '0.2.0',
  date: '2026-08-09',
  stats: [
    { label: 'files', value: '91' },
    { label: 'added', value: '+5 805', tone: palette.added },
    { label: 'removed', value: '-1 454', tone: palette.removed },
    { label: 'tests', value: '490' },
  ],
  sections: [
    {
      tag: 'Added',
      tone: palette.added,
      items: [
        'Modular prompt compiler with per-mode instructions',
        'Tools: curl, update_plan, get_config, inspect_image',
        'create_skill, plus three built-in skills',
        'User themes, discovery panel, shell highlighting',
      ],
    },
    {
      tag: 'Fixed',
      tone: palette.accent,
      items: [
        'Typing no longer becomes a pasted-content attachment',
        'Each turn keeps its own paragraph in the transcript',
        'Resizing no longer duplicates the session on Windows',
      ],
    },
    {
      tag: 'Security',
      tone: palette.warn,
      items: [
        'get_config redacts MCP headers and env by location',
      ],
    },
  ],
};

const escape = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

const W = 860;
const PAD = 34;

function statBlock(stat, x, y) {
  return `
    <text x="${x}" y="${y}" font-family="${MONO}" font-size="26" font-weight="600" fill="${stat.tone ?? palette.text}">${escape(stat.value)}</text>
    <text x="${x}" y="${y + 19}" font-family="${FONT}" font-size="11.5" letter-spacing="0.6" fill="${palette.faint}">${escape(stat.label.toUpperCase())}</text>`;
}

function sectionBlock(section, y) {
  const rows = section.items
    .map(
      (item, index) => `
    <circle cx="${PAD + 6}" cy="${y + 28 + index * 23 - 4}" r="2.5" fill="${section.tone}" opacity="0.75"/>
    <text x="${PAD + 20}" y="${y + 28 + index * 23}" font-family="${FONT}" font-size="14.5" fill="${palette.text}" opacity="0.92">${escape(item)}</text>`,
    )
    .join('');

  return `
    <text x="${PAD}" y="${y}" font-family="${FONT}" font-size="11.5" font-weight="700" letter-spacing="1.4" fill="${section.tone}">${escape(section.tag.toUpperCase())}</text>
    <line x1="${PAD + section.tag.length * 8.6 + 14}" y1="${y - 4}" x2="${W - PAD}" y2="${y - 4}" stroke="${palette.edge}" stroke-width="1"/>
    ${rows}`;
}

let cursor = 208;
const sections = release.sections
  .map((section) => {
    const block = sectionBlock(section, cursor);
    cursor += 34 + section.items.length * 23;
    return block;
  })
  .join('');

const H = cursor + 30;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="plif ${release.from} to ${release.to} changelog">
  <title>plif ${escape(release.from)} to ${escape(release.to)}</title>
  <defs>
    <linearGradient id="surface" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${palette.surfaceTop}"/>
      <stop offset="1" stop-color="${palette.surface}"/>
    </linearGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${palette.accent}" stop-opacity="0.9"/>
      <stop offset="1" stop-color="${palette.brand}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="url(#surface)" stroke="${palette.edge}"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="3" rx="1.5" fill="url(#rule)"/>

  <g transform="translate(${PAD}, 52)">
    <text font-family="${MONO}" font-size="21" font-weight="700" fill="${palette.text}" letter-spacing="0.5">plif</text>
    <text x="52" y="0" font-family="${MONO}" font-size="15" fill="${palette.faint}">${escape(release.from)}</text>
    <text x="107" y="0" font-family="${MONO}" font-size="15" fill="${palette.brand}">-&gt;</text>
    <text x="133" y="0" font-family="${MONO}" font-size="15" font-weight="700" fill="${palette.accent}">${escape(release.to)}</text>
    <text x="${W - PAD * 2}" y="0" text-anchor="end" font-family="${MONO}" font-size="13" fill="${palette.faint}">${escape(release.date)}</text>
  </g>

  <text x="${PAD}" y="94" font-family="${FONT}" font-size="13.5" fill="${palette.muted}">A container-native coding agent for your terminal. Bring your own model.</text>

  <line x1="${PAD}" y1="118" x2="${W - PAD}" y2="118" stroke="${palette.edge}"/>

  <g>${release.stats.map((stat, index) => statBlock(stat, PAD + index * 178, 156)).join('')}</g>

  <line x1="${PAD}" y1="185" x2="${W - PAD}" y2="185" stroke="${palette.edge}"/>

  ${sections}
</svg>
`;

mkdirSync(path.join(root, 'assets'), { recursive: true });
const target = path.join(root, 'assets', `changelog-${release.to}.svg`);
writeFileSync(target, svg, 'utf8');
console.log(`wrote ${path.relative(root, target)} (${svg.length} bytes, ${W}x${H})`);
