import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createHarnessCycle,
  inspectionPaths,
  isFileMutationTool,
  isShellMutation,
  isValidationObservation,
  mutationGate,
  mutationPaths,
  observeHarnessCycle,
  reviewGate,
} from '../src/harness/cycle.js';

describe('Plan → Work → Review cycle', () => {
  it('requires a plan before a mutation and fresh evidence before completion', () => {
    const initial = createHarnessCycle();

    assert.equal(initial.phase, 'plan');
    assert.match(mutationGate(initial) ?? '', /update_plan/);

    const working = observeHarnessCycle(initial, { type: 'plan_ready' });
    assert.equal(working.phase, 'work');
    assert.equal(mutationGate(working), null);

    const changed = observeHarnessCycle(working, {
      type: 'mutation',
      paths: ['/workspace/src/app.ts', '/workspace/src/types.ts'],
    });
    const review = observeHarnessCycle(changed, { type: 'review_requested' });

    assert.equal(review.phase, 'review');
    assert.match(reviewGate(review) ?? '', /changed file/);

    const inspectedFirst = observeHarnessCycle(review, {
      type: 'inspection',
      paths: ['/workspace/src/app.ts'],
    });
    assert.match(reviewGate(inspectedFirst) ?? '', /types\.ts/);

    const inspected = observeHarnessCycle(inspectedFirst, {
      type: 'inspection',
      paths: ['\\workspace\\src\\types.ts'],
    });
    assert.match(reviewGate(inspected) ?? '', /validation/);

    const validated = observeHarnessCycle(inspected, { type: 'validation' });
    assert.equal(reviewGate(validated), null);
  });

  it('returns to Work and invalidates review evidence after another change', () => {
    let state = observeHarnessCycle(createHarnessCycle(), { type: 'plan_ready' });
    state = observeHarnessCycle(state, { type: 'mutation', paths: ['/workspace/a.ts'] });
    state = observeHarnessCycle(state, { type: 'inspection', paths: ['/workspace/a.ts'] });
    state = observeHarnessCycle(state, { type: 'validation' });
    state = observeHarnessCycle(state, { type: 'review_requested' });

    assert.equal(reviewGate(state), null);

    const changedAgain = observeHarnessCycle(state, {
      type: 'mutation',
      paths: ['/workspace/a.ts'],
    });
    assert.equal(changedAgain.phase, 'work');
    assert.equal(changedAgain.revision, 2);
    assert.match(reviewGate(observeHarnessCycle(changedAgain, { type: 'review_requested' })) ?? '', /changed file/);
  });
});

describe('cycle tool classification', () => {
  it('recognizes all structured file mutation tools', () => {
    assert.equal(isFileMutationTool('write_file'), true);
    assert.equal(isFileMutationTool('edit_file'), true);
    assert.equal(isFileMutationTool('apply_patch'), true);
    assert.equal(isFileMutationTool('read_file'), false);
  });

  it('extracts paths from single-file and transactional edits', () => {
    assert.deepEqual(
      mutationPaths('edit_file', { path: '/workspace/a.ts' }),
      ['/workspace/a.ts'],
    );
    assert.deepEqual(
      mutationPaths('apply_patch', {
        edits: [{ path: '/workspace/a.ts' }, { path: '/workspace/b.ts' }],
      }),
      ['/workspace/a.ts', '/workspace/b.ts'],
    );
  });

  it('does not gate PLIF-owned checkpoint artifacts as user changes', () => {
    assert.deepEqual(
      mutationPaths('write_file', { path: '/project/.plif/plans/2026-08-23-task.md' }),
      [],
    );
    assert.deepEqual(
      mutationPaths('apply_patch', {
        edits: [
          { path: '/project/.plif/plans/current.md' },
          { path: '/project/src/app.ts' },
        ],
      }),
      ['/project/src/app.ts'],
    );
    assert.deepEqual(
      mutationPaths('apply_patch', {
        edits: [{ path: '/project/.plif/plans/current.md' }],
      }),
      [],
    );
  });

  it('puts ordinary shell writes through the same plan and review gate', () => {
    assert.equal(isShellMutation('shell_command', { script: "Set-Content -LiteralPath app.ts -Value 'x'" }), true);
    assert.equal(isShellMutation('run_command', { argv: ['git', 'apply', 'change.patch'] }), true);
    assert.equal(isShellMutation('run_command', { argv: ['rg', 'needle', 'src'] }), false);
    assert.deepEqual(
      mutationPaths('shell_command', { script: "Set-Content -LiteralPath app.ts -Value 'x'" }),
      ['*'],
    );
  });

  it('treats diagnostics and final diff inspection as review evidence', () => {
    assert.deepEqual(inspectionPaths('read_file', { path: '/workspace/a.ts' }), ['/workspace/a.ts']);
    assert.deepEqual(inspectionPaths('diagnostics', { path: '/workspace/a.ts' }), ['/workspace/a.ts']);
    assert.deepEqual(
      inspectionPaths('run_command', { argv: ['git', 'diff', '--check'] }),
      ['*'],
    );
    assert.equal(isValidationObservation('diagnostics', {}), true);
    assert.equal(isValidationObservation('run_command', { argv: ['npm', 'test'] }), true);
    assert.equal(isValidationObservation('run_command', { argv: ['rg', 'needle'] }), false);
  });
});
