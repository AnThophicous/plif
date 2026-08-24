import fs from 'node:fs/promises';
import path from 'node:path';

import { tokenSplitConfigPath } from './store.js';
import type {
  TokenSplitConfig,
  TokenSplitMetricRecord,
  TokenSplitSanityObservation,
  TokenSplitSanityResult,
  TokenSplitTechniqueId,
  TokenSplitTransformation,
} from './types.js';

const queues = new Map<string, Promise<void>>();

function sanityFile(workspace: string): string {
  return path.join(workspace, '.plif', 'token-split', 'sanity.jsonl');
}

function sessionFile(workspace: string, sessionId: string): string {
  const safe = sessionId.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 100) || 'interactive';
  return path.join(workspace, '.plif', 'token-split', 'sessions', `${safe}.jsonl`);
}

export function tokenSplitMetricsPath(workspace: string, sessionId: string): string {
  return sessionFile(workspace, sessionId);
}

export async function appendTokenSplitMetric(
  workspace: string,
  sessionId: string,
  record: TokenSplitMetricRecord,
): Promise<void> {
  const file = sessionFile(workspace, sessionId);
  const previous = queues.get(file) ?? Promise.resolve();
  const next = previous.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, JSON.stringify(record) + '\n', 'utf8');
  });
  queues.set(file, next);
  try { await next; } finally {
    if (queues.get(file) === next) queues.delete(file);
  }
}

export async function appendTokenSplitSanity(
  workspace: string,
  results: readonly TokenSplitSanityResult[],
): Promise<void> {
  const file = sanityFile(workspace);
  const previous = queues.get(file) ?? Promise.resolve();
  const next = previous.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const ts = new Date().toISOString();
    const lines = results.map((result): TokenSplitSanityObservation => ({
      ts,
      technique: result.technique,
      status: result.status,
    }));
    if (lines.length > 0) await fs.appendFile(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n', 'utf8');
  });
  queues.set(file, next);
  try { await next; } finally {
    if (queues.get(file) === next) queues.delete(file);
  }
}

export async function readTokenSplitSanity(workspace: string): Promise<TokenSplitSanityObservation[]> {
  const text = await fs.readFile(sanityFile(workspace), 'utf8').catch(() => '');
  const observations: TokenSplitSanityObservation[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as Partial<TokenSplitSanityObservation>;
      if (typeof value.ts !== 'string' || typeof value.technique !== 'string') continue;
      if (value.status !== 'pass' && value.status !== 'fail' && value.status !== 'not-wired') continue;
      observations.push({ ts: value.ts, technique: value.technique as TokenSplitTechniqueId, status: value.status });
    } catch { /* ignore a partial final line */ }
  }
  return observations;
}

export function tokenSplitSanityRate(
  observations: readonly TokenSplitSanityObservation[],
  technique: TokenSplitTechniqueId,
  window: number,
): { samples: number; rate: number | null } {
  const relevant = observations
    .filter((observation) => observation.technique === technique && observation.status !== 'not-wired')
    .slice(-Math.max(1, window));
  if (relevant.length === 0) return { samples: 0, rate: null };
  return {
    samples: relevant.length,
    rate: relevant.filter((observation) => observation.status === 'pass').length / relevant.length,
  };
}

export function makeTokenSplitMetric(
  turn: number,
  baselineTokens: number,
  inputTokens: number,
  outputTokens: number,
  pressure: string,
  transformations: readonly TokenSplitTransformation[],
  config: TokenSplitConfig,
  reportedPromptTokens?: number,
  cache?: { readonly hit?: number; readonly miss?: number },
): TokenSplitMetricRecord {
  const sent = reportedPromptTokens && reportedPromptTokens > 0 ? reportedPromptTokens : inputTokens;
  const inputUsd = config.prices.inputPerM > 0 ? sent / 1_000_000 * config.prices.inputPerM : null;
  const outputUsd = config.prices.outputPerM > 0 ? outputTokens / 1_000_000 * config.prices.outputPerM : null;
  return {
    version: 1,
    turn,
    ts: new Date().toISOString(),
    inputTokens: { enviados: sent, baseline: baselineTokens },
    outputTokens,
    // null means the provider did not expose cache accounting. Zero is only
    // written when an adapter actually reported a zero.
    cache: { hit: cache?.hit ?? null, miss: cache?.miss ?? null },
    custo: {
      inputUsd,
      outputUsd,
      totalUsd: inputUsd === null || outputUsd === null ? null : inputUsd + outputUsd,
    },
    pressao: pressure,
    transformacoes: transformations,
    sanidade: [],
  };
}

export async function readTokenSplitMetrics(workspace: string, sessionId?: string): Promise<TokenSplitMetricRecord[]> {
  const directory = path.join(workspace, '.plif', 'token-split', 'sessions');
  const files = sessionId ? [sessionFile(workspace, sessionId)] : await fs.readdir(directory).then((names) => names.filter((name) => name.endsWith('.jsonl')).map((name) => path.join(directory, name))).catch(() => [] as string[]);
  const records: TokenSplitMetricRecord[] = [];
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8').catch(() => '');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line) as TokenSplitMetricRecord); } catch { /* ignore a partial final line */ }
    }
  }
  return records.sort((left, right) => left.ts.localeCompare(right.ts));
}

export async function resetTokenSplitMetrics(workspace: string): Promise<void> {
  await fs.rm(path.join(workspace, '.plif', 'token-split'), { recursive: true, force: true });
}

export async function readTokenSplitAudit(workspace: string): Promise<readonly TokenSplitMetricRecord[]> {
  return await readTokenSplitMetrics(workspace);
}

export function tokenSplitStorePath(): string {
  return tokenSplitConfigPath();
}
