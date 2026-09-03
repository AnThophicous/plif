/**
 * The two prompt sections Code Mode adds, and why they sit where they do.
 *
 * The collapse notice goes *before* the per-tool guidance. A model that meets a
 * list of tool names first will try to call one, and the refusal it gets back
 * costs a whole turn to learn something one sentence could have told it. The
 * generated SDK goes *after* that guidance, because the guidance explains when
 * to reach for a tool and the SDK explains how — reversing them makes the model
 * read a type declaration for a decision it has not made yet.
 */

import { CODE_MODE_COLLAPSE_NOTICE, renderToolsSdk } from '../harness/code-mode/index.js';
import { definePromptModule } from './types.js';

export const codeModeNoticeModule = definePromptModule({
  id: '52-code-mode',
  order: 52,
  enabled: (context) => context.toolMode === 'code' || context.toolMode === 'both',
  render: (context) =>
    [
      '# Calling tools',
      '',
      context.toolMode === 'code'
        ? CODE_MODE_COLLAPSE_NOTICE
        : 'You can call tools directly, or write a `run_code` program that calls several of ' +
          'them in one turn. Prefer the program past a single call.',
      '',
      'A program is the cheaper unit of work whenever more than one call is involved:',
      'batch independent reads, search then read the hits, edit then verify, apply one',
      'change across several files. Only what the program logs and returns enters the',
      'conversation, so use it to keep large intermediate output out of the context —',
      'read the files, return the finding.',
    ].join('\n'),
});

export const codeModeSdkModule = definePromptModule({
  id: '66-code-mode-sdk',
  order: 66,
  enabled: (context) =>
    (context.toolMode === 'code' || context.toolMode === 'both') &&
    (context.tools?.length ?? 0) > 0,
  render: (context) => renderToolsSdk(context.tools ?? []),
});
