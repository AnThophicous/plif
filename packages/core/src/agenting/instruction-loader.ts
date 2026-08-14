import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PromptMode } from './types.js';

export interface MarkdownInstruction {
  readonly id: string;
  readonly order: number;
  readonly modes: readonly PromptMode[] | undefined;
  readonly effort: string | undefined;
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
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDirectory, 'instructions'),
    path.resolve(moduleDirectory, '../../src/agenting/instructions'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Plif agent instruction assets are missing.');
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
  const metadata = new Map<string, string>();
  for (const part of (match?.[1] ?? '').split(/\s+/)) {
    const separator = part.indexOf('=');
    if (separator > 0) metadata.set(part.slice(0, separator), part.slice(separator + 1));
  }

  const relativePath = path.relative(root, file).replaceAll(path.sep, '/');
  const id = metadata.get('id') ?? relativePath.replace(/\.md$/, '');
  const order = Number.parseInt(metadata.get('order') ?? '50', 10);
  if (!Number.isFinite(order)) throw new Error(`Invalid instruction order in ${relativePath}`);
  const rawModes = metadata.get('modes');
  const modes = rawModes ? rawModes.split(',').filter(isPromptMode) : undefined;
  return {
    id,
    order,
    modes: modes?.length ? modes : undefined,
    effort: metadata.get('effort'),
    relativePath,
    source: raw.slice(match?.[0].length ?? 0).trim(),
  };
}

function isPromptMode(value: string): value is PromptMode {
  return value === 'primary' ||
    value === 'subagent' ||
    value === 'explore' ||
    value === 'review' ||
    value === 'compaction';
}

