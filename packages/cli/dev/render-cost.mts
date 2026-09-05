/**
 * How much work the transcript overlay does per frame, as it grows.
 *
 * The overlay re-measures every cell on every render to know how tall the
 * content is and which slice is visible. That is O(transcript) work at the
 * paint cadence, so this says at what size it stops fitting in a frame.
 */
import { measureTranscriptCell, measureTranscriptCells } from '../src/components/Timeline.js';
import { initialViewport, viewportReducer, visibleTranscriptSlice } from '../src/transcript/scroll.js';
import type { TranscriptCell } from '../src/transcript/types.js';

function makeCells(pairs: number): TranscriptCell[] {
  const cells: TranscriptCell[] = [];
  for (let i = 0; i < pairs; i += 1) {
    cells.push({ id: `u${i}`, kind: 'user', text: `question number ${i} `.repeat(6) } as TranscriptCell);
    cells.push({ id: `a${i}`, kind: 'assistant', text: `answer paragraph ${i}. `.repeat(40) } as TranscriptCell);
  }
  return cells;
}

const width = 120;
const FRAME_MS = 1000 / 30;

for (const size of [50, 250, 1000, 3000]) {
  const cells = makeCells(size / 2);
  const iterations = 30;
  // Warm, so the first pass does not pay for JIT.
  measureTranscriptCells(cells, width, true);
  const started = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    const total = measureTranscriptCells(cells, width, true);
    const viewport = viewportReducer(initialViewport, {
      type: 'open',
      contentLines: total,
      height: 40,
    });
    visibleTranscriptSlice(cells, viewport, 40, (cell) => measureTranscriptCell(cell, width, true));
  }
  const per = (performance.now() - started) / iterations;
  process.stdout.write(
    `${String(cells.length).padStart(5)} cells → ${per.toFixed(2).padStart(8)} ms/frame  ` +
      `${per > FRAME_MS ? `OVER budget (${(per / FRAME_MS).toFixed(1)}x)` : 'within budget'}\n`,
  );
}
