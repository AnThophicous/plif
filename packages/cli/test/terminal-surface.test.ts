import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { terminalSurfaceLayout } from '../src/components/TerminalSurface.js';
import { color } from '../src/theme.js';

describe('full-bleed terminal surface', () => {
  it('fills the available canvas at wide and intermediate widths', () => {
    const wide = terminalSurfaceLayout(96, 40);
    const intermediate = terminalSurfaceLayout(72, 24);

    assert.equal(wide.panelWidth, wide.canvasWidth);
    assert.equal(intermediate.panelWidth, intermediate.canvasWidth);
    assert.ok(wide.contentWidth < wide.panelWidth);
  });

  it('keeps the full-bleed surface at the minimum preview width', () => {
    const narrow = terminalSurfaceLayout(40, 12);

    assert.equal(narrow.panelWidth, 40);
    assert.equal(narrow.canvasHeight, 11);
    assert.ok(narrow.contentWidth > 0);
    assert.ok(narrow.contentHeight > 0);
  });

  it('keeps the panel inside the canvas for undersized dimensions', () => {
    const tiny = terminalSurfaceLayout(1, 1);

    assert.ok(tiny.panelWidth <= tiny.canvasWidth);
    assert.ok(tiny.panelHeight <= tiny.canvasHeight);
    assert.ok(tiny.contentWidth >= 1);
    assert.ok(tiny.contentHeight >= 1);
  });

  it('budgets the live panel below the header instead of extending the scroll frame', () => {
    const withHeader = terminalSurfaceLayout(96, 40, 13);
    assert.equal(withHeader.panelHeight, withHeader.canvasHeight - 13);
    assert.ok(withHeader.contentHeight < terminalSurfaceLayout(96, 40).contentHeight);
  });

  it('uses a distinct panel token', () => {
    assert.notEqual(color('panel'), color('surface'));
    assert.equal(color('panel'), '#303030');
  });
});
