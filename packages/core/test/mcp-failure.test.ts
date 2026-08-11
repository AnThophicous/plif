/**
 * What a failed MCP connection is allowed to put on screen.
 *
 * A URL that is not an MCP endpoint answers with a web page, and the SDK hands
 * the whole page over as the error message. Rendered verbatim it buried the one
 * fact worth knowing under a screenful of doctype and inline CSS.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { condenseMcpFailure, isDroppedConnection } from '../src/harness/mcp.js';

const PAGE = [
  '<!DOCTYPE html>',
  '<html>',
  '  <head>',
  '    <meta http-equiv="Content-type" content="text/html; charset=utf-8">',
  '    <title>404 Not Found</title>',
  '    <style>body { font-family: sans-serif; padding: 4rem; }</style>',
  '  </head>',
  '  <body><h1>Not Found</h1><p>The requested URL was not found.</p></body>',
  '</html>',
].join('\n');

describe('condenseMcpFailure', () => {
  it('replaces an HTML body with the page title', () => {
    const condensed = condenseMcpFailure(
      `Streamable HTTP error: Error POSTing to endpoint: ${PAGE}`,
    );

    assert.match(condensed, /HTML page titled "404 Not Found"/);
    assert.match(condensed, /Streamable HTTP error: Error POSTing to endpoint/);
    assert.doesNotMatch(condensed, /doctype|<html|font-family/i);
    assert.equal(condensed.includes('\n'), false);
  });

  it('leads with the diagnosis, because the tail is what a narrow row drops', () => {
    const condensed = condenseMcpFailure(
      `Streamable HTTP error: Error POSTing to endpoint: ${PAGE}`,
    );

    assert.ok(
      condensed.indexOf('404 Not Found') < condensed.indexOf('Streamable HTTP error'),
      `boilerplate came first: ${condensed}`,
    );
    assert.ok(condensed.slice(0, 80).includes('404 Not Found'));
  });

  it('still says what happened when the page has no title', () => {
    const condensed = condenseMcpFailure('POST failed: <html><body>gateway timeout</body></html>');

    assert.match(condensed, /HTML page, so it is not an MCP endpoint/);
    assert.match(condensed, /POST failed/);
    assert.doesNotMatch(condensed, /<html/);
  });

  it('decodes the entities a title is escaped with', () => {
    // GitHub's error page, verbatim. The title is the part a person reads, so
    // showing them `&middot;` is showing them the markup instead of the answer.
    const condensed = condenseMcpFailure(
      '<!DOCTYPE html><html><head><title>Oh no &middot; GitHub</title></head></html>',
    );

    assert.match(condensed, /titled "Oh no · GitHub"/);
    assert.doesNotMatch(condensed, /&middot;|&amp;|&#/);
  });

  it('decodes numeric entities, in both bases', () => {
    const decimal = condenseMcpFailure('<html><title>429 &#8212; slow down</title></html>');
    const hex = condenseMcpFailure('<html><title>Caf&#xE9; gateway</title></html>');

    assert.match(decimal, /"429 — slow down"/);
    assert.match(hex, /"Café gateway"/);
  });

  it('leaves an unknown entity as written rather than dropping it', () => {
    const condensed = condenseMcpFailure('<html><title>a &notanentity; b</title></html>');
    assert.match(condensed, /a &notanentity; b/);
  });

  it('leaves an ordinary message alone', () => {
    const reason = 'connect ECONNREFUSED 127.0.0.1:9000';
    assert.equal(condenseMcpFailure(reason), reason);
  });

  it('clips a long non-HTML message rather than letting it run', () => {
    const condensed = condenseMcpFailure('x'.repeat(4_000));
    assert.ok(condensed.length <= 180, `expected a clipped reason, got ${condensed.length}`);
    assert.match(condensed, /…$/);
  });

  it('collapses the newlines that would turn one notice into twenty', () => {
    assert.equal(condenseMcpFailure('spawn failed\n\n  at Object.<anonymous>\n  at Module._compile'),
      'spawn failed at Object.<anonymous> at Module._compile');
  });
});

describe('isDroppedConnection', () => {
  it('recognizes the ways a live server goes away', () => {
    for (const message of [
      'MCP server "x" is not connected',
      'Connection closed',
      'read ECONNRESET',
      'write EPIPE',
      'socket hang up',
      'The operation was terminated',
    ]) {
      assert.equal(isDroppedConnection(new Error(message)), true, message);
    }
  });

  it('leaves a real tool failure to be reported rather than retried', () => {
    // Retrying these spends the turn restarting a healthy server instead of
    // telling the model its arguments were wrong.
    for (const message of [
      'Invalid arguments: expected string, received number',
      'tool "search" not found',
      'rate limited, try again in 30s',
    ]) {
      assert.equal(isDroppedConnection(new Error(message)), false, message);
    }
  });
});
