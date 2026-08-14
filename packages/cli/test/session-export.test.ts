import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatSessionExport, sessionExportFileName } from '../src/session-export.js';
import type { TranscriptCell } from '../src/transcript/types.js';

const cells: readonly TranscriptCell[] = [
  {
    id: 'u1', turnId: 't1', at: '2026-08-13T12:00:00.000Z', kind: 'user', finalized: true,
    text: 'make the tests pass',
  },
  {
    id: 'a1', turnId: 't1', at: '2026-08-13T12:00:01.000Z', kind: 'assistant', finalized: true,
    phase: 'final', text: 'Done.',
  },
];

describe('session export', () => {
  it('keeps the goal and transcript readable as plain text', () => {
    const output = formatSessionExport({
      cells,
      workspace: 'C:\\src\\plif',
      goal: 'all tests pass',
      exportedAt: new Date('2026-08-13T12:34:56.000Z'),
    });

    assert.match(output, /Session goal: all tests pass/);
    assert.match(output, /## User\nmake the tests pass/);
    assert.match(output, /## Assistant\nDone\./);
  });

  it('uses a safe timestamped txt filename', () => {
    assert.equal(sessionExportFileName(new Date('2026-08-13T12:34:56.000Z')), 'plif-session-2026-08-13T12-34-56Z.txt');
  });
});
