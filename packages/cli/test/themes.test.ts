import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { applyEffortPalette, color, palette, syntaxColor } from '../src/theme.js';
import { semanticWave } from '../src/pulse.js';
import { activateTheme, loadThemes, MINIMAL_THEME, parseTheme } from '../src/themes.js';

describe('user themes', () => {
  it('uses the controlled-test gold roles in the default theme', () => {
    activateTheme(MINIMAL_THEME);
    assert.equal(color('brand'), '#CC9A3A');
    assert.equal(color('faint'), '#CC9A3A');
    assert.equal(color('accentDim'), '#C68E17');
    assert.equal(color('muted'), '#E8C170');
    assert.equal(color('accentBright'), '#E8C170');
    assert.equal(color('text'), '#FFD700');
    assert.equal(color('accent'), '#E0A526');
  });

  it('accepts the complete override surface and applies semantic values', () => {
    const theme = parseTheme({
      id: 'quiet', name: 'Quiet',
      palette: { text: '#ffffff', muted: '#777777' },
      syntax: { command: 'text', parameter: 'muted', keyword: 'accent', function: 'info' },
      diff: { addBackground: '#001100', removeBackground: '#110000', addMarker: 'success', removeMarker: 'danger' },
      borders: { panel: 'muted' },
      emphasis: { important: { tone: 'text', bold: true } },
      glyphs: { tool: '*' },
      layout: { gutter: 2 },
    }, 'fallback');
    activateTheme(theme);
    assert.equal(color('text'), '#ffffff');
    assert.equal(syntaxColor('parameter'), '#777777');
    assert.equal(syntaxColor('keyword'), color('accent'));
    assert.equal(syntaxColor('function'), color('info'));
    activateTheme(MINIMAL_THEME);
  });

  it('does not replace the active theme when Plif effort is selected', () => {
    const theme = parseTheme({
      id: 'chromatic-test', name: 'Chromatic test',
      palette: {
        brand: '#123456',
        accentDim: '#234567',
        accent: '#345678',
        accentBright: '#456789',
      },
    }, 'fallback');
    activateTheme(theme);
    applyEffortPalette('plif');
    assert.equal(palette.brand, '#123456');
    assert.equal(palette.accentDim, '#234567');
    assert.equal(palette.accent, '#345678');
    assert.equal(palette.accentBright, '#456789');
    activateTheme(MINIMAL_THEME);
    applyEffortPalette();
  });

  it('keeps named theme colours instead of turning a Plif wave black', () => {
    const theme = parseTheme({
      id: 'named-colours', name: 'Named colours',
      palette: {
        brand: 'red',
        accentDim: 'magenta',
        accent: 'blue',
        accentBright: 'cyan',
      },
    }, 'fallback');
    activateTheme(theme);

    for (const phase of [0, 0.2, 0.4, 0.7, 0.95]) {
      const wave = semanticWave(phase);
      assert.notEqual(wave, '#000000');
      assert.ok(['red', 'magenta', 'blue', 'cyan'].includes(wave));
    }

    activateTheme(MINIMAL_THEME);
    applyEffortPalette();
  });

  it('discovers JSONC .theme files and reports invalid ones without losing valid themes', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-theme-'));
    const directory = path.join(home, '.plif');
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'night.theme'), '{ // comment\n "name": "Night", "palette": { "text": "#eeeeee" }, }');
    await fs.writeFile(path.join(directory, 'broken.theme'), '{ "unknown": true }');
    const catalogue = await loadThemes(home);
    assert.deepEqual(catalogue.themes.map((theme) => theme.id), ['minimal', 'midnight', 'night']);
    assert.equal(catalogue.problems.length, 1);
  });
});
