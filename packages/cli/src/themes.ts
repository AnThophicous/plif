import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { stripJsonComments } from '@plif/core';
import {
  applyTheme,
  borders,
  diffStyle,
  emphasis,
  glyph,
  layout,
  palette,
  syntax,
} from './theme.js';
import type { ThemeOverrides } from './theme.js';

export interface ThemeDefinition extends ThemeOverrides {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly source: 'builtin' | 'user';
  readonly file?: string;
}

export interface ThemeCatalogue {
  readonly themes: readonly ThemeDefinition[];
  readonly problems: readonly string[];
}

export const MINIMAL_THEME: ThemeDefinition = {
  id: 'minimal',
  name: 'Minimal',
  description: 'Quiet Plif blue-grey with semantic colour only when it carries meaning.',
  source: 'builtin',
};

/**
 * MidNight.
 *
 * The primary dark variant keeps the same cold Plif hierarchy while giving the
 * surface more depth. Effort accents still come from the central ramp.
 */
export const MIDNIGHT_THEME: ThemeDefinition = {
  id: 'midnight',
  name: 'MidNight',
  description: 'Near-black surface, with Plif blue-grey kept to chrome and thinking.',
  source: 'builtin',
  palette: {
    text: '#CDD6F4',
    panel: '#303030',
    surface: '#202328',
    muted: '#89959E',
    faint: '#65717C',
    ghost: '#4D5862',
    brand: '#AAB8CC',
    accent: '#e8a8c9',
    accentBright: '#f0bcd8',
    accentDim: '#c890ac',
    accentStrong: '#c890ac',
    accentPastel: '#f7d4e6',
    accentTint: '#4a3542',
    accentBorder: '#7a5568',
    goldDim: '#7a5568',
    goldBase: '#e8a8c9',
    gold: '#f0bcd8',
    goldBright: '#f7d4e6',
    warmIvory: '#f7d4e6',
    success: '#8FB3A6',
    warn: '#BDAA82',
    danger: '#C58F99',
    info: '#A2ADB5',
  },
  syntax: {
    command: 'text',
    parameter: 'muted',
    keyword: 'accentDim',
    function: 'info',
    type: 'accent',
    property: 'muted',
    string: 'faint',
    variable: 'text',
    operator: 'ghost',
    number: 'warn',
    comment: 'ghost',
    plain: 'muted',
  },
  borders: { panel: 'ghost', focus: 'accent', danger: 'danger' },
  diff: { addBackground: '#263832', removeBackground: '#3B2E34', addMarker: 'success', removeMarker: 'danger' },
  emphasis: {
    normal: { tone: 'muted' },
    important: { tone: 'text', bold: true },
    active: { tone: 'text', bold: true },
    metadata: { tone: 'ghost' },
  },
};

export function themeDirectory(home = os.homedir()): string {
  return path.join(home, '.plif');
}

export async function loadThemes(home = os.homedir()): Promise<ThemeCatalogue> {
  const directory = themeDirectory(home);
  let files: string[] = [];
  try {
    files = (await fs.readdir(directory)).filter((file) => file.toLowerCase().endsWith('.theme')).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const themes: ThemeDefinition[] = [MINIMAL_THEME, MIDNIGHT_THEME];
  const problems: string[] = [];
  const loaded = await Promise.all(files.map(async (file) => {
    const absolute = path.join(directory, file);
    try {
      const raw = await fs.readFile(absolute, 'utf8');
      const parsed = JSON.parse(stripJsonComments(raw)) as unknown;
      return { kind: 'theme' as const, theme: parseTheme(parsed, file.replace(/\.theme$/i, ''), absolute) };
    } catch (error) {
      return { kind: 'problem' as const, problem: `${file}: ${error instanceof Error ? error.message : String(error)}` };
    }
  }));
  // Promise.all preserves the directory order, keeping picker ordering and
  // diagnostics identical to the sequential loader.
  for (const item of loaded) {
    if (item.kind === 'theme') themes.push(item.theme);
    else problems.push(item.problem);
  }
  return { themes, problems };
}

export function activateTheme(theme: ThemeDefinition): void {
  applyTheme(theme);
}

export function parseTheme(value: unknown, fallbackId: string, file?: string): ThemeDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('theme root must be an object');
  const input = value as Record<string, unknown>;
  const allowed = new Set(['$schema', 'id', 'name', 'description', 'palette', 'syntax', 'diff', 'borders', 'emphasis', 'glyphs', 'layout']);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`unknown theme fields: ${unknown.join(', ')}`);

  const id = stringValue(input['id']) ?? fallbackId;
  const name = stringValue(input['name']) ?? id;
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) throw new Error('id must contain only letters, digits, dot, dash or underscore');

  const overrides: ThemeOverrides = {
    palette: stringMap(input['palette'], new Set(Object.keys(palette)), 'palette'),
    syntax: enumMap(input['syntax'], new Set(Object.keys(syntax)), new Set(Object.keys(palette)), 'syntax'),
    borders: enumMap(input['borders'], new Set(Object.keys(borders)), new Set(Object.keys(palette)), 'borders'),
    diff: mixedMap(input['diff'], new Set(Object.keys(diffStyle)), 'diff'),
    glyphs: stringMap(input['glyphs'], new Set(Object.keys(glyph)), 'glyphs'),
    layout: numberMap(input['layout'], new Set(Object.keys(layout)), 'layout'),
    emphasis: emphasisMap(input['emphasis']),
  };
  return {
    id,
    name,
    source: 'user',
    ...(stringValue(input['description']) ? { description: stringValue(input['description'])! } : {}),
    ...(file ? { file } : {}),
    ...overrides,
  };
}

function objectValue(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function checkKeys(input: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`unknown ${label} fields: ${unknown.join(', ')}`);
}

function stringMap(value: unknown, allowed: ReadonlySet<string>, label: string): Record<string, string> | undefined {
  const input = objectValue(value, label);
  if (!input) return undefined;
  checkKeys(input, allowed, label);
  for (const [key, item] of Object.entries(input)) {
    if (typeof item !== 'string') throw new Error(`${label}.${key} must be a string`);
    if (key.endsWith('Marker') && !(item in palette)) throw new Error(`${label}.${key} is not a palette key`);
  }
  return input as Record<string, string>;
}

function enumMap(value: unknown, allowed: ReadonlySet<string>, choices: ReadonlySet<string>, label: string): Record<string, never> | undefined {
  const input = stringMap(value, allowed, label);
  if (!input) return undefined;
  for (const [key, item] of Object.entries(input)) if (!choices.has(item)) throw new Error(`${label}.${key} is not a palette key`);
  return input as Record<string, never>;
}

function numberMap(value: unknown, allowed: ReadonlySet<string>, label: string): Record<string, number> | undefined {
  const input = objectValue(value, label);
  if (!input) return undefined;
  checkKeys(input, allowed, label);
  for (const [key, item] of Object.entries(input)) {
    if (typeof item !== 'number' || !Number.isFinite(item) || item < 0) throw new Error(`${label}.${key} must be a non-negative number`);
  }
  return input as Record<string, number>;
}

function mixedMap(value: unknown, allowed: ReadonlySet<string>, label: string): Record<string, never> | undefined {
  const input = objectValue(value, label);
  if (!input) return undefined;
  checkKeys(input, allowed, label);
  for (const [key, item] of Object.entries(input)) {
    if (typeof item !== 'string') throw new Error(`${label}.${key} must be a string`);
    if (key.endsWith('Marker') && !(item in palette)) throw new Error(`${label}.${key} is not a palette key`);
  }
  return input as Record<string, never>;
}

function emphasisMap(value: unknown): ThemeOverrides['emphasis'] {
  const input = objectValue(value, 'emphasis');
  if (!input) return undefined;
  checkKeys(input, new Set(Object.keys(emphasis)), 'emphasis');
  const output: Record<string, { tone?: never; bold?: boolean }> = {};
  for (const [key, raw] of Object.entries(input)) {
    const row = objectValue(raw, `emphasis.${key}`) ?? {};
    checkKeys(row, new Set(['tone', 'bold']), `emphasis.${key}`);
    if (row['tone'] !== undefined && (typeof row['tone'] !== 'string' || !(row['tone'] in palette))) {
      throw new Error(`emphasis.${key}.tone is not a palette key`);
    }
    if (row['bold'] !== undefined && typeof row['bold'] !== 'boolean') throw new Error(`emphasis.${key}.bold must be boolean`);
    output[key] = { ...(row['tone'] ? { tone: row['tone'] as never } : {}), ...(typeof row['bold'] === 'boolean' ? { bold: row['bold'] } : {}) };
  }
  return output as ThemeOverrides['emphasis'];
}
