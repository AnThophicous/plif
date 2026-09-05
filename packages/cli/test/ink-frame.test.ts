import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function finalFrame(output: string): string {
  const clear = '\u001b[2J';
  const frame = output.includes(clear) ? output.slice(output.lastIndexOf(clear) + clear.length) : output;
  return frame.replace(ANSI, '').replace(/\r/g, '');
}

describe('Slate frame hierarchy', () => {
  it('normalizes to the final clear-screen frame', () => {
    assert.equal(finalFrame(`old\u001b[2Jnew`), 'new');
  });

  it('leaves only the append-only history Static inside App', () => {
    const source = fs.readFileSync(new URL('../src/app.tsx', import.meta.url), 'utf8');
    assert.equal(source.match(/^\s*<Static\b/gm)?.length, 1);
    assert.doesNotMatch(source, /SessionHeader/);
    assert.doesNotMatch(source, /InfinityMark/);
    assert.match(source, /import \{ Header(?:, headerHeight)? \} from '\.\/components\/Header\.js'/);
    assert.equal(source.match(/^\s*<Header\b/gm)?.length, 1);
    assert.match(source, /const liveSurfaceHeight = pastedTextPopup \? surface\.canvasHeight : surface\.panelHeight/);
    assert.match(source, /height=\{pastedTextPopup \? liveSurfaceHeight : headerHeight\(headerAvailableWidth\) \+ liveSurfaceHeight\}/);
    assert.match(source, /paddingX=\{surface\.panelPaddingX\}/);
    assert.equal(source.match(/rows=\{surface\.panelHeight\}/g)?.length, 8);
    assert.doesNotMatch(source, /rows=\{rows\}/);
    assert.doesNotMatch(source, /<TerminalSurface\b/);
    assert.match(source, /<Box flexGrow=\{1\} \/>/);

    const bottomSpacer = source.lastIndexOf('<Box flexGrow={1} />');
    const completions = source.lastIndexOf('{showCompletions && (');
    const promptDock = source.lastIndexOf('<Box flexDirection="column" flexShrink={0}>');
    assert.ok(bottomSpacer < completions, 'command suggestions belong below the expanding spacer');
    assert.ok(completions < promptDock, 'command suggestions belong immediately above the prompt dock');
  });
});
