import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  describeToolCall,
  displayUrl,
  languageServerNote,
  parseSearchResults,
  toolCategory,
  toolLane,
  formatError,
} from '../src/format.js';
import { PlifError } from '@plif/core';

describe('command error presentation', () => {
  it('keeps actionable invalid-argument errors free of internal code noise', () => {
    const error = formatError(new PlifError('INVALID_ARGUMENT', 'Unknown effort "banana".', {
      hint: 'Available: low, medium, high',
    }));
    assert.equal(error.title, 'Unknown effort "banana".');
    assert.equal(error.detail, 'Available: low, medium, high');
  });
});

describe('planning tool presentation', () => {
  it('keeps checkpoints structured for the compact timeline row', () => {
    const described = describeToolCall('update_plan', {
      explanation: 'The approach changed.',
      plan: [
        { step: 'Inspect the renderer', status: 'completed' },
        { step: 'Implement the compact row', status: 'in_progress' },
        { step: 'Verify the build', status: 'pending' },
      ],
    });

    assert.equal(described.label, 'Plan updated');
    assert.equal(described.target, undefined);
    assert.deepEqual(described.planItems, [
      { step: 'Inspect the renderer', status: 'completed' },
      { step: 'Implement the compact row', status: 'in_progress' },
      { step: 'Verify the build', status: 'pending' },
    ]);
  });

  it('does not leak malformed checkpoints into the UI', () => {
    const described = describeToolCall('update_plan', {
      plan: [
        { step: '', status: 'completed' },
        { step: 'Valid', status: 'pending' },
        { step: 'Broken', status: 'wat' },
      ],
    });
    assert.deepEqual(described.planItems, [{ step: 'Valid', status: 'pending' }]);
  });
});

describe('tool timeline lanes', () => {
  it('keeps discovery and child sessions out of ordinary history rows', () => {
    assert.equal(toolLane('read_file'), 'discovery');
    assert.equal(toolLane('list_dir'), 'discovery');
    assert.equal(toolLane('subagent'), 'subagent');
    assert.equal(toolLane('run_command'), 'timeline');
  });
});

describe('tool visual categories', () => {
  it('keeps operation identity separate from status and labels', () => {
    assert.equal(toolCategory('run_command'), 'shell');
    assert.equal(toolCategory('read_file'), 'read');
    assert.equal(toolCategory('list_dir'), 'list');
    assert.equal(toolCategory('grep'), 'search');
    assert.equal(toolCategory('apply_patch'), 'edit');
    assert.equal(toolCategory('web_fetch'), 'network');
    assert.equal(toolCategory('mcp__github__search_code'), 'external');
  });

  it('describes the new structured tools without dumping their payloads', () => {
    assert.deepEqual(describeToolCall('grep', { pattern: 'TODO' }), {
      label: 'Grep',
      category: 'search',
      target: 'TODO',
    });
    assert.deepEqual(describeToolCall('apply_patch', { edits: [{ path: 'src/app.tsx' }] }), {
      label: 'Update',
      category: 'edit',
      target: 'src/app.tsx',
    });

    assert.deepEqual(describeToolCall('apply_patch', { edits: [{}, {}] }), {
      label: 'Update',
      category: 'edit',
      target: '2 files',
    });
  });

  it('gives language-server tools readable programming labels', () => {
    assert.deepEqual(describeToolCall('diagnostics', { path: '/project/src/app.tsx' }), {
      label: 'Diagnostics',
      category: 'read',
      target: '/project/src/app.tsx',
    });
    assert.equal(describeToolCall('find_definition', { path: '/project/src/app.tsx' }).label, 'Definition');
    assert.equal(describeToolCall('find_references', { path: '/project/src/app.tsx' }).label, 'References');
    assert.equal(describeToolCall('outline', { path: '/project/src/app.tsx' }).label, 'Outline');
  });
});

describe('edit diagnostics', () => {
  it('keeps language-server feedback visible next to an edit diff', () => {
    assert.equal(
      languageServerNote(
        'edited /project/app.ts — added 1 line\n\nLanguage server: 1 error(s), 0 warning(s)\nsrc/app.ts:3:7 TS2322: wrong type',
      ),
      'Language server: 1 error(s), 0 warning(s)\nsrc/app.ts:3:7 TS2322: wrong type',
    );
    assert.equal(languageServerNote('edited /project/app.ts — added 1 line'), null);
  });
});

describe('search results in a timeline row', () => {
  const OUTPUT = [
    '## Results',
    '1. Angular Signals guide',
    '   https://angular.dev/guide/signals',
    '   Signals are a reactive primitive that tracks reads.',
    '2. RxJS interop',
    '   https://www.rxjs.dev/api/index/function/toSignal/',
    '3. Release notes',
    '   https://angular.dev/releases',
    '',
    '## Related',
    '- Signals FAQ: https://angular.dev/faq',
  ].join('\n');

  it('reads the ranked list back out of the text the tool returned', () => {
    const hits = parseSearchResults(OUTPUT);

    assert.equal(hits.length, 3);
    assert.equal(hits[0]?.title, 'Angular Signals guide');
    assert.equal(hits[0]?.url, 'https://angular.dev/guide/signals');
    assert.match(hits[0]?.snippet ?? '', /reactive primitive/);
    assert.equal(hits[1]?.snippet, undefined);
    assert.deepEqual(hits.map((hit) => hit.rank), [1, 2, 3]);
  });

  it('ignores related links and anything that is not a ranked hit', () => {
    assert.deepEqual(parseSearchResults('- Signals FAQ: https://angular.dev/faq'), []);
    assert.deepEqual(parseSearchResults('1. A heading with no url'), []);
    assert.deepEqual(parseSearchResults(''), []);
  });

  it('reads every grouped research source without trusting arbitrary Sources markers', () => {
    const researchOutput = [
      'Objective: compare implementations',
      '',
      'Query 1: official contract',
      'Purpose: establish the supported API',
      'Status: 1 ranked source(s)',
      'Sources:',
      '1. Official documentation',
      '   https://docs.example.test/api',
      '   ## challenge is literal snippet text',
      '',
      'Query 2: independent failure report',
      'Purpose: find counter-evidence',
      'Status: 1 ranked source(s)',
      'Sources:',
      '2. Independent report',
      '   https://review.example.test/report',
      '   Reproduces the failure.',
      '',
      'Coverage: 2 unique ranked sources.',
    ].join('\n');

    assert.deepEqual(parseSearchResults(researchOutput), [
      {
        rank: 1,
        title: 'Official documentation',
        url: 'https://docs.example.test/api',
        snippet: '## challenge is literal snippet text',
      },
      {
        rank: 2,
        title: 'Independent report',
        url: 'https://review.example.test/report',
        snippet: 'Reproduces the failure.',
      },
    ]);

    assert.deepEqual(
      parseSearchResults('Objective: text\nSources:\n1. Fake\nhttps://evil.example.test'),
      [],
    );
  });

  it('treats indented structural-looking snippets as data without admitting fake hits', () => {
    const output = [
      '## Results',
      '1. Legitimate result',
      '   https://docs.example.test/real',
      '   ## Results',
      '2. Still legitimate',
      '   https://docs.example.test/second',
      '   Sources:',
      '3. Fake without an indented URL',
      'https://evil.example.test',
    ].join('\n');

    assert.deepEqual(parseSearchResults(output), [
      {
        rank: 1,
        title: 'Legitimate result',
        url: 'https://docs.example.test/real',
        snippet: '## Results',
      },
      {
        rank: 2,
        title: 'Still legitimate',
        url: 'https://docs.example.test/second',
        snippet: 'Sources:',
      },
    ]);
  });

  it('shows the part of a url worth a row of terminal', () => {
    assert.equal(displayUrl('https://www.rxjs.dev/api/toSignal/', 40), 'rxjs.dev/api/toSignal');
    assert.equal(displayUrl('https://angular.dev/guide/signals', 12), 'angular.dev…');
  });
});
