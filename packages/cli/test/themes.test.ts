import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { applyEffortPalette, color, palette, syntaxColor, TERMINAL_BACKGROUND } from '../src/theme.js';
import { semanticWave } from '../src/pulse.js';
import { activateTheme, loadThemes, MINIMAL_THEME, parseTheme } from '../src/themes.js';

describe('user themes', () => {
  it('uses the controlled-test gold roles in the default theme', () => {
    activateTheme(MINIMAL_THEME);
    assert.equal(TERMINAL_BACKGROUND, '#303030');
    assert.equal(color('panel'), TERMINAL_BACKGROUND);
    assert.equal(color('brand'), '#CC9A3A');
    assert.equal(color('faint'), '#CC9A3A');
    assert.equal(color('accentDim'), '#C68E17');
    assert.equal(color('muted'), '#E8C170');
    assert.equal(color('accentBright'), '#E8C170');
    assert.equal(color('text'), '#FFD700');
    assert.equal(color('accent'), '#E0A526');
  });

  it('keeps the terminal canvas fixed when a theme or effort changes', () => {
    const theme = parseTheme({
      id: 'black-panel', name: 'Black panel',
      palette: { panel: '#000000' },
    }, 'fallback');
    activateTheme(theme);
    assert.equal(color('panel'), TERMINAL_BACKGROUND);
    applyEffortPalette('max');
    assert.equal(color('panel'), TERMINAL_BACKGROUND);
    activateTheme(MINIMAL_THEME);
    applyEffortPalette();
  });

  it('keeps effort colors distinct and reserves hottest gold for Plif', () => {
    activateTheme(MINIMAL_THEME);
    const expected = {
      low: {
        text: '#FFF1B2', muted: '#F5D98A', faint: '#D8B565', ghost: '#947A45',
        brand: '#D8B565', accent: '#F0C96C', accentBright: '#FFF1B2', accentDim: '#D4A646',
        info: '#F0C96C', warn: '#D4A646',
      },
      medium: {
        text: '#FFE99A', muted: '#F0CE72', faint: '#D2A849', ghost: '#896A31',
        brand: '#D2A849', accent: '#E9BE55', accentBright: '#FFE99A', accentDim: '#CC941F',
        info: '#E9BE55', warn: '#CC941F',
      },
      high: {
        text: '#FFDF75', muted: '#E9BB4A', faint: '#C28D23', ghost: '#79591D',
        brand: '#C28D23', accent: '#E2AA35', accentBright: '#FFDF75', accentDim: '#B67A13',
        info: '#E2AA35', warn: '#B67A13',
      },
      xhigh: {
        text: '#FFD957', muted: '#E3AD2F', faint: '#B87916', ghost: '#6E4A13',
        brand: '#B87916', accent: '#D99A21', accentBright: '#FFD957', accentDim: '#A96A0C',
        info: '#D99A21', warn: '#A96A0C',
      },
      max: {
        text: '#eadbff', muted: '#c49aff', faint: '#6337a8', ghost: '#432775',
        brand: '#6337a8', accent: '#c49aff', accentBright: '#eadbff', accentDim: '#9568d0',
        info: '#c49aff', warn: '#9568d0',
      },
      ultra: {
        text: '#FFCB20', muted: '#DC9513', faint: '#9E5A09', ghost: '#5F3806',
        brand: '#9E5A09', accent: '#D17F0A', accentBright: '#FFCB20', accentDim: '#924E04',
        info: '#D17F0A', warn: '#924E04',
      },
      ultracode: {
        text: '#FFC20A', muted: '#D58A08', faint: '#955005', ghost: '#582D04',
        brand: '#955005', accent: '#C87304', accentBright: '#FFC20A', accentDim: '#894502',
        info: '#C87304', warn: '#894502',
      },
    } as const;

    for (const [effort, paletteValues] of Object.entries(expected)) {
      applyEffortPalette(effort);
      assert.deepEqual(
        {
          text: palette.text,
          muted: palette.muted,
          faint: palette.faint,
          ghost: palette.ghost,
          brand: palette.brand,
          accent: palette.accent,
          accentBright: palette.accentBright,
          accentDim: palette.accentDim,
          info: palette.info,
          warn: palette.warn,
        },
        paletteValues,
        effort,
      );
      assert.notEqual(palette.accent, '#E0A526', `${effort} should not use the Plif accent`);
      assert.notEqual(palette.text, '#FFD700', `${effort} should not use the Plif text`);
    }
    applyEffortPalette('plif');
    assert.equal(palette.text, '#FFD700');
    assert.equal(palette.accent, '#E0A526');
    assert.equal(palette.accentBright, '#E8C170');
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
