import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { color, syntaxColor } from '../src/theme.js';
import { activateTheme, loadThemes, MINIMAL_THEME, parseTheme } from '../src/themes.js';

describe('user themes', () => {
  it('accepts the complete override surface and applies semantic values', () => {
    const theme = parseTheme({
      id: 'quiet', name: 'Quiet',
      palette: { text: '#ffffff', muted: '#777777' },
      syntax: { command: 'text', parameter: 'muted' },
      diff: { addBackground: '#001100', removeBackground: '#110000', addMarker: 'success', removeMarker: 'danger' },
      borders: { panel: 'muted' },
      emphasis: { important: { tone: 'text', bold: true } },
      glyphs: { tool: '*' },
      layout: { gutter: 2 },
    }, 'fallback');
    activateTheme(theme);
    assert.equal(color('text'), '#ffffff');
    assert.equal(syntaxColor('parameter'), '#777777');
    activateTheme(MINIMAL_THEME);
  });

  it('discovers JSONC .theme files and reports invalid ones without losing valid themes', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-theme-'));
    const directory = path.join(home, '.plif');
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'night.theme'), '{ // comment\n "name": "Night", "palette": { "text": "#eeeeee" }, }');
    await fs.writeFile(path.join(directory, 'broken.theme'), '{ "unknown": true }');
    const catalogue = await loadThemes(home);
    assert.deepEqual(catalogue.themes.map((theme) => theme.id), ['minimal', 'night']);
    assert.equal(catalogue.problems.length, 1);
  });
});
