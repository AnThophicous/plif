/**
 * What the stats screen shows, derived from the session store.
 *
 * Kept pure and separate from the store so the arithmetic that produces a
 * streak or a heatmap can be tested against a fixed set of rows rather than
 * against a database. Everything here is derived: nothing is stored twice.
 */

import type { SessionUsageRow } from './history-repository.js';

export interface TokenTotals {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

export interface ModelStats {
  readonly modelId: string;
  readonly sessions: number;
  readonly tokens: TokenTotals;
  /** Share of the period's total tokens, 0..1. */
  readonly share: number;
}

/** One cell of the activity heatmap. */
export interface ActivityDay {
  /** Local calendar day, `YYYY-MM-DD`. */
  readonly date: string;
  readonly sessions: number;
}

export interface SessionStats {
  readonly range: { readonly from: string; readonly to: string };
  readonly days: readonly ActivityDay[];
  readonly sessions: number;
  readonly activeDays: number;
  /** Days in the range that could have had activity. */
  readonly totalDays: number;
  readonly mostActiveDay: ActivityDay | null;
  readonly longestSessionMs: number;
  readonly longestStreak: number;
  readonly currentStreak: number;
  readonly favoriteModel: ModelStats | null;
  readonly models: readonly ModelStats[];
  readonly tokens: TokenTotals;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The local calendar day of an instant, as `YYYY-MM-DD`. */
export function dayKey(at: Date): string {
  const year = at.getFullYear();
  const month = `${at.getMonth() + 1}`.padStart(2, '0');
  const day = `${at.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Local midnight for a `YYYY-MM-DD` key. */
export function dayStart(key: string): Date {
  const [year, month, day] = key.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function emptyTotals(): TokenTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function addTotals(left: TokenTotals, right: TokenTotals): TokenTotals {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
  };
}

export function totalTokens(totals: TokenTotals): number {
  return totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
}

/**
 * The longest run of consecutive active days, and the run ending today.
 *
 * "Current" deliberately also accepts a run that ended yesterday: a streak
 * should not appear broken for the whole of the day before you next sit down.
 */
function streaks(active: readonly string[], today: string): {
  longest: number;
  current: number;
} {
  if (active.length === 0) return { longest: 0, current: 0 };
  const sorted = [...active].sort();
  let longest = 1;
  let run = 1;
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = dayStart(sorted[index - 1]!).getTime();
    const day = dayStart(sorted[index]!).getTime();
    run = day - previous === DAY_MS ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  const last = dayStart(sorted.at(-1)!).getTime();
  const gap = dayStart(today).getTime() - last;
  return { longest, current: gap <= DAY_MS ? run : 0 };
}

export interface StatsOptions {
  /** Only count sessions started on or after this local day. */
  readonly since?: string;
  /** Treated as "today" for streaks and for the end of the range. */
  readonly now?: Date;
}

/**
 * Fold session rows into everything the screen draws.
 *
 * Rows arrive one per (session, model): a session that used two models is two
 * rows, so sessions are counted through their ids rather than by row.
 */
export function summariseSessions(
  rows: readonly SessionUsageRow[],
  options: StatsOptions = {},
): SessionStats {
  const now = options.now ?? new Date();
  const today = dayKey(now);
  const sessionsSeen = new Map<string, { day: string; durationMs: number }>();
  const perDay = new Map<string, Set<string>>();
  const perModel = new Map<string, { sessions: Set<string>; tokens: TokenTotals }>();
  let tokens = emptyTotals();
  let earliest = today;

  for (const row of rows) {
    const started = new Date(row.createdAt);
    if (Number.isNaN(started.getTime())) continue;
    const day = dayKey(started);
    if (options.since && day < options.since) continue;
    if (day < earliest) earliest = day;

    if (!sessionsSeen.has(row.sessionId)) {
      const ended = new Date(row.updatedAt);
      const durationMs = Number.isNaN(ended.getTime())
        ? 0
        : Math.max(0, ended.getTime() - started.getTime());
      sessionsSeen.set(row.sessionId, { day, durationMs });
      const days = perDay.get(day) ?? new Set<string>();
      days.add(row.sessionId);
      perDay.set(day, days);
    }

    const rowTokens: TokenTotals = {
      input: row.inputTokens,
      output: row.outputTokens,
      cacheRead: row.cacheReadTokens,
      cacheWrite: row.cacheWriteTokens,
    };
    tokens = addTotals(tokens, rowTokens);
    if (row.modelId) {
      const entry = perModel.get(row.modelId) ?? { sessions: new Set<string>(), tokens: emptyTotals() };
      entry.sessions.add(row.sessionId);
      entry.tokens = addTotals(entry.tokens, rowTokens);
      perModel.set(row.modelId, entry);
    }
  }

  const from = options.since ?? earliest;
  const days: ActivityDay[] = [];
  for (
    let at = dayStart(from).getTime();
    at <= dayStart(today).getTime();
    at += DAY_MS
  ) {
    const key = dayKey(new Date(at));
    days.push({ date: key, sessions: perDay.get(key)?.size ?? 0 });
  }

  const active = days.filter((day) => day.sessions > 0);
  const mostActive = active.reduce<ActivityDay | null>(
    (best, day) => (best === null || day.sessions > best.sessions ? day : best),
    null,
  );
  const { longest, current } = streaks(active.map((day) => day.date), today);
  const grandTotal = totalTokens(tokens);
  const models = [...perModel]
    .map(([modelId, entry]) => ({
      modelId,
      sessions: entry.sessions.size,
      tokens: entry.tokens,
      share: grandTotal > 0 ? totalTokens(entry.tokens) / grandTotal : 0,
    }))
    // Tokens first, because that is what the share column is about; sessions
    // break the tie so a model used often but cheaply still ranks.
    .sort((left, right) =>
      totalTokens(right.tokens) - totalTokens(left.tokens)
      || right.sessions - left.sessions
      || left.modelId.localeCompare(right.modelId));

  return {
    range: { from, to: today },
    days,
    sessions: sessionsSeen.size,
    activeDays: active.length,
    totalDays: days.length,
    mostActiveDay: mostActive,
    longestSessionMs: [...sessionsSeen.values()]
      .reduce((longestRun, entry) => Math.max(longestRun, entry.durationMs), 0),
    longestStreak: longest,
    currentStreak: current,
    favoriteModel: models[0] ?? null,
    models,
    tokens,
  };
}

/** The `since` day for a range, or undefined for all of it. */
export function rangeStart(range: 'all' | '7d' | '30d', now = new Date()): string | undefined {
  if (range === 'all') return undefined;
  const back = range === '7d' ? 6 : 29;
  return dayKey(new Date(now.getTime() - back * DAY_MS));
}
