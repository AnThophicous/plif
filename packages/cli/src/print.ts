/**
 * Plain-text output, for the commands that never mount Ink.
 *
 * `plif sessions` and `plif sandbox` are meant to be piped, grepped and read by
 * CI, so they print unstyled text to stdout and put anything diagnostic on
 * stderr. Keeping these helpers away from the theme module is deliberate: the
 * theme knows about colour and terminal capability, and none of that applies
 * when the destination might be a file.
 */

import path from 'node:path';

/** Collapse the home directory to `~`, without any styling. */
export function plain(target: string): string {
  const home = process.env['USERPROFILE'] ?? process.env['HOME'] ?? '';
  const resolved = path.resolve(target);
  if (home && resolved.toLowerCase().startsWith(home.toLowerCase())) {
    return '~' + resolved.slice(home.length).replace(/\\/g, '/');
  }
  return resolved.replace(/\\/g, '/');
}

/**
 * "3 minutes ago", "yesterday", "12 Mar".
 *
 * Relative time is what a session list is actually asked about — "which one was
 * I in?" — and an ISO timestamp makes the reader do the subtraction. Past a
 * week it flips to an absolute date, because "37 days ago" is a worse answer
 * than the date.
 */
export function formatRelative(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'unknown';

  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 45) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;

  const date = new Date(then);
  const month = date.toLocaleString('en', { month: 'short' });
  return `${date.getDate()} ${month}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}
