import React from 'react';
import { Text } from '../ui.js';

import { ActivityLabel, activityColorAt, activityGlyphAt, activityKindForLabel, activityVisual } from '../activity-visuals.js';
import { plifGlyphFramesForTerminal } from '../plif-glyphs.js';
import { color, formatCount, formatDuration, formatWorkedDuration, glyph, supportsRichGlyphs } from '../theme.js';
import { ANIMATION_INTERVAL_MS, useAnimationFrame, usePlifAnimation } from '../hooks/useAnimationClock.js';

/**
 * Braille dots. Eight frames, one cell wide, and — unlike a spinning slash —
 * the motion happens *inside* the character rather than by changing its
 * silhouette, so the line next to it does not appear to jitter.
 */
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'];
const ASCII_FRAMES = ['-', '\\', '|', '/'];

const frames = supportsRichGlyphs ? FRAMES : ASCII_FRAMES;
const MIN_SPINNER_INTERVAL_MS = 220;

/**
 * A bud opening into a flower, and closing again.
 *
 * The braille spinner above says "a machine is turning". This says "something
 * is growing", which is the honest description of a model working: it is not
 * cycling through fixed states, it is elaborating. It starts as a filled ball
 * so the first frame after Enter is solid and unmistakable, then blooms.
 *
 * Every frame is one cell wide and drawn from the same dingbat family, so the
 * silhouette grows and shrinks in place instead of jittering the line beside
 * it — the same reason the braille frames were chosen over a spinning slash.
 */
const bloomFrames = plifGlyphFramesForTerminal('bloom', supportsRichGlyphs);

/** The open flower. Used at rest, where nothing is animating. */
export const BLOOM_MARK = bloomFrames[3] as string;

export function bloomFrameAt(frame: number, intervalMs = 320): string {
  const index = Math.floor((Math.max(0, frame) * ANIMATION_INTERVAL_MS) / Math.max(1, intervalMs));
  return bloomFrames[index % bloomFrames.length] as string;
}

/**
 * What to call what the agent is doing.
 *
 * Deliberately varied and deliberately vague: the honest answer to "what is it
 * doing right now" is unknowable from out here, and a word that changes between
 * turns reads as a live process where a fixed "Working" reads as a frozen
 * screen. Chosen from the turn number rather than the clock so it stays put for
 * the length of one turn — a label that changed every 120ms would be a
 * flickering word nobody can read.
 */
const WORDS = [
  'Pondering',
  'Thinking',
  'Reasoning',
  'Musing',
  'Weaving',
  'Puzzling',
  'Distilling',
  'Untangling',
  'Composing',
  'Considering',
  'Tinkering',
  'Wrangling',
] as const;

export function workingWord(seed: number): string {
  return WORDS[Math.abs(Math.trunc(seed)) % WORDS.length] as string;
}

/**
 * Advances a frame index on an interval.
 *
 * Separated from the component so the timer exists once per spinner rather than
 * once per render, and so it can be shared by anything else that needs a tick.
 */
export function spinnerFrameAt(frame: number, intervalMs = 220): string {
  const index = Math.floor(
    (Math.max(0, frame) * ANIMATION_INTERVAL_MS) / Math.max(MIN_SPINNER_INTERVAL_MS, intervalMs),
  );
  return frames[index % frames.length] as string;
}

export function useSpinnerFrame(intervalMs = 220, active = true): string {
  const frame = useAnimationFrame(active);
  const plif = usePlifAnimation();
  if (plif && active) return frames[0] as string;
  return active ? spinnerFrameAt(frame, intervalMs) : frames[0] as string;
}

/**
 * A live elapsed-time counter.
 *
 * Re-renders once a second, not on every spinner frame. A developer watching a
 * slow command wants to know it is alive (the spinner) and how long it has been
 * going (this) — and updating a duration ten times a second makes it unreadable
 * without telling them anything more.
 */
export function useElapsed(since: number, active = true): number {
  // Running components repaint from the shared animation clock. Reading the
  // wall clock here keeps the elapsed value accurate without adding one more
  // interval for every visible spinner.
  useAnimationFrame(active);
  return active ? Math.max(0, Date.now() - since) : 0;
}

interface SpinnerProps {
  readonly label?: string;
  /** When set, an elapsed counter is drawn after the label. */
  readonly since?: number;
  readonly tone?: Parameters<typeof color>[0];
  readonly plif?: boolean;
}

export interface WorkingProps {
  /** Which word to show. Stable for the length of a turn. */
  readonly seed: number;
  readonly since: number;
  readonly tokens: number;
  /** True while the count is a running estimate rather than provider usage. */
  readonly estimated?: boolean;
  readonly plif?: boolean;
}

export function workingFacts(
  elapsed: number,
  tokens: number,
  estimated = false,
  plif = false,
): readonly string[] {
  return [
    ...(!plif ? [formatWorkedDuration(elapsed)] : []),
    ...(tokens > 0 ? [`${glyph.tokens} ${estimated ? '~' : ''}${formatCount(tokens)} tokens`] : []),
  ];
}

/**
 * The one line that says the agent is alive.
 *
 * Everything on it earns its place: the bloom says work is happening, the word
 * says roughly what kind, the elapsed time says how long you have been waiting,
 * and the token count says it is still producing rather than stuck. Anything
 * else belongs in the transcript.
 */
export const Working = React.memo(function Working({ seed, since, tokens, estimated, plif = false }: WorkingProps): React.ReactElement {
  const frame = useAnimationFrame();
  const elapsed = useElapsed(since, !plif);
  const facts = workingFacts(elapsed, tokens, estimated, plif);
  const label = workingWord(seed);
  const kind = activityKindForLabel(label);
  const visual = activityVisual(kind);

  return (
    <Text>
      <ActivityLabel
        glyph={activityGlyphAt(kind, frame * ANIMATION_INTERVAL_MS, true)}
        value={label}
        from={visual.gradient[0]}
        to={visual.gradient[1]}
        shimmerMs={frame * ANIMATION_INTERVAL_MS}
      />
      <Text color={color('muted')}>…</Text>
      {facts.length > 0 && <Text color={color('ghost')}> ({facts.join(` ${glyph.divider} `)})</Text>}
    </Text>
  );
});

export const Spinner = React.memo(function Spinner({ label, since, tone = 'accent', plif = false }: SpinnerProps): React.ReactElement {
  const frame = useSpinnerFrame();
  const activityFrame = useAnimationFrame(true, 'slow');
  const elapsed = useElapsed(since ?? Date.now(), since !== undefined && !plif);
  const activityLabel = label ?? 'Working';
  const kind = activityKindForLabel(activityLabel);
  const visual = activityVisual(kind);
  const glyphColor = plif
    ? activityColorAt(kind, activityFrame * ANIMATION_INTERVAL_MS)
    : color(tone);

  return (
    <Text>
      {plif ? (
        <ActivityLabel
          glyph={activityGlyphAt(kind, activityFrame * ANIMATION_INTERVAL_MS, true)}
          value={activityLabel}
          from={visual.gradient[0]}
          to={visual.gradient[1]}
          shimmerMs={activityFrame * ANIMATION_INTERVAL_MS}
        />
      ) : (
        <>
          <Text color={glyphColor} bold>{frame}</Text>
          <Text> </Text>
          <ActivityLabel glyph="" value={activityLabel} from={visual.gradient[0]} to={visual.gradient[1]} />
        </>
      )}
      {!plif && since !== undefined && elapsed >= 1000 && (
        <Text color={color('ghost')}> {formatDuration(elapsed)}</Text>
      )}
    </Text>
  );
});
