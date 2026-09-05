import fs from 'node:fs';
import path from 'node:path';

import { moduleDirectory, resolveAsset } from '../assets.js';
import type { PromptMode } from './types.js';

export interface MarkdownInstruction {
  readonly id: string;
  readonly order: number;
  readonly modes: readonly PromptMode[] | undefined;
  readonly effort: string | undefined;
  readonly tools: readonly string[] | undefined;
  readonly minContext: number | undefined;
  readonly maxContext: number | undefined;
  readonly relativePath: string;
  readonly source: string;
}

const DIRECTIVE = /^<!--\s*plif:\s*([^>]+)-->\s*(?:\r?\n)?/;
let cache: readonly MarkdownInstruction[] | undefined;

export function loadMarkdownInstructions(): readonly MarkdownInstruction[] {
  cache ??= readInstructionFiles(instructionDirectory());
  return cache;
}

export function listInstructionModules(): readonly string[] {
  return loadMarkdownInstructions().map((instruction) => instruction.relativePath);
}

export function instruction(id: string): MarkdownInstruction {
  const found = loadMarkdownInstructions().find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing Plif agent instruction: ${id}`);
  return found;
}

export function renderInstruction(
  source: string,
  values: Readonly<Record<string, string>> = {},
): string {
  return source.replace(/\{\{([a-z0-9_]+)\}\}/gi, (token, key: string) => values[key] ?? token).trim();
}

export function resetInstructionCache(): void {
  cache = undefined;
}

function instructionDirectory(): string {
  const here = moduleDirectory(import.meta.url);
  const found = resolveAsset(import.meta.url, 'instructions', [
    path.join(here, 'instructions'),
    path.resolve(here, '../../src/agenting/instructions'),
  ]);
  if (found === null) throw new Error('Plif agent instruction assets are missing.');
  return found;
}

function readInstructionFiles(root: string): readonly MarkdownInstruction[] {
  const files = walk(root)
    .filter((file) => file.endsWith('.md'))
    .sort((left, right) => left.localeCompare(right));
  const seen = new Set<string>();
  const loaded = files.map((file) => parseInstruction(root, file));
  for (const entry of loaded) {
    if (seen.has(entry.id)) throw new Error(`Duplicate Plif agent instruction id: ${entry.id}`);
    seen.add(entry.id);
  }
  return loaded.sort(
    (left, right) => left.order - right.order || left.relativePath.localeCompare(right.relativePath),
  );
}

function walk(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(candidate));
    else if (entry.isFile()) files.push(candidate);
  }
  return files;
}

function parseInstruction(root: string, file: string): MarkdownInstruction {
  const raw = fs.readFileSync(file, 'utf8');
  const match = DIRECTIVE.exec(raw);
  const directive = (match?.[1] ?? '').trim().replace(/,\s+/g, ',');
  const metadata = parseInstructionMetadata(directive, path.basename(file));

  const relativePath = path.relative(root, file).replaceAll(path.sep, '/');
  const id = metadata.get('id') ?? relativePath.replace(/\.md$/, '');
  const order = Number.parseInt(metadata.get('order') ?? '50', 10);
  if (!Number.isFinite(order)) throw new Error(`Invalid instruction order in ${relativePath}`);
  const rawModes = metadata.get('modes');
  const modeNames = rawModes ? parseCsvMetadata(rawModes, 'mode', relativePath) : undefined;
  if (modeNames?.some((mode) => !isPromptMode(mode))) {
    throw new Error(`Invalid instruction mode in ${relativePath}: ${rawModes}`);
  }
  const modes = modeNames as PromptMode[] | undefined;
  const rawTools = metadata.get('tools');
  const tools = rawTools ? parseCsvMetadata(rawTools, 'tool', relativePath) : undefined;
  if (tools?.some((name) => !/^[a-z0-9_.:-]+$/i.test(name))) {
    throw new Error(`Invalid instruction tool in ${relativePath}: ${rawTools}`);
  }
  return {
    id,
    order,
    modes,
    effort: metadata.get('effort'),
    tools,
    minContext: optionalPositiveInteger(metadata.get('minContext'), 'minContext', relativePath),
    maxContext: optionalPositiveInteger(metadata.get('maxContext'), 'maxContext', relativePath),
    relativePath,
    source: raw.slice(match?.[0].length ?? 0).trim(),
  };
}

export function parseInstructionMetadata(
  directive: string,
  sourceName = 'instruction',
): ReadonlyMap<string, string> {
  const metadata = new Map<string, string>();
  const allowedMetadata = new Set(['id', 'order', 'modes', 'effort', 'tools', 'minContext', 'maxContext']);
  for (const part of directive ? directive.split(/\s+/) : []) {
    const separator = part.indexOf('=');
    if (separator <= 0) throw new Error(`Invalid instruction metadata in ${sourceName}: ${part}`);
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (!allowedMetadata.has(key)) throw new Error(`Unknown instruction metadata in ${sourceName}: ${key}`);
    if (metadata.has(key)) throw new Error(`Duplicate instruction metadata in ${sourceName}: ${key}`);
    if (!value) throw new Error(`Empty instruction metadata in ${sourceName}: ${key}`);
    metadata.set(key, value);
  }
  for (const kind of ['modes', 'tools'] as const) {
    const value = metadata.get(kind);
    if (value) parseCsvMetadata(value, kind === 'modes' ? 'mode' : 'tool', sourceName);
  }
  return metadata;
}

function optionalPositiveInteger(value: string | undefined, key: string, sourceName: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid instruction ${key} in ${sourceName}: ${value}`);
  }
  return parsed;
}

function parseCsvMetadata(value: string, kind: string, sourceName: string): string[] {
  const values = value.split(',').map((entry) => entry.trim());
  if (values.some((entry) => !entry)) {
    throw new Error(`Invalid instruction ${kind} list in ${sourceName}: ${value}`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`Duplicate instruction ${kind} in ${sourceName}: ${value}`);
  }
  return values;
}

function isPromptMode(value: string): value is PromptMode {
  return value === 'primary' ||
    value === 'subagent' ||
    value === 'explore' ||
    value === 'review' ||
    value === 'compaction';
}
