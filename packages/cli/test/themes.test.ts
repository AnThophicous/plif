import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { applyEffortPalette, color, effortPalette, palette, syntaxColor } from '../src/theme.js';
import { semanticWave } from '../src/pulse.js';
import { activateTheme, loadThemes, MINIMAL_THEME, parseTheme } from '../src/themes.js';

describe('user themes', () => {
  it('uses the cold Plif anchors in the default theme', () => {
    activateTheme(MINIMAL_THEME);
    assert.equal(color('panel'), '#303030');
    assert.equal(color('brand'), '#AAB8CC');
    assert.equal(color('faint'), '#7C848A');
    assert.equal(color('muted'), '#89959E');
    assert.equal(color('accentBright'), '#CDD6F4');
    assert.equal(color('text'), '#A2ADB5');
  });

  it('keeps effort accents inside one cold ramp and reserves the anchor for Plif', () => {
    activateTheme(MINIMAL_THEME);
    for (const [effort, paletteValues] of Object.entries(effortPalette)) {
      applyEffortPalette(effort);
      for (const [key, value] of Object.entries(paletteValues)) {
        assert.equal(palette[key as keyof typeof palette], value, `${effort}.${key}`);
      }
      assert.equal(palette.text, '#A2ADB5', `${effort} keeps primary text stable`);
      assert.equal(palette.muted, '#89959E', `${effort} keeps secondary text stable`);
    }
    applyEffortPalette('plif');
    assert.equal(palette.accentBright, '#CDD6F4');
    applyEffortPalette();
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
