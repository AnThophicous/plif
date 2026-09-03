/**
 * Code Mode moved into its own directory once it became a runtime rather than a
 * refusal. This file stays as the import path the rest of the tree already
 * uses, so lifting the quarantine did not become a rename across the codebase.
 */

export {
  CODE_MODE_COLLAPSE_NOTICE,
  DEFAULT_CODE_MODE_LIMITS,
  DispatchLimitError,
  DispatchScheduler,
  FrameReader,
  RUN_CODE_SPEC,
  RUN_CODE_TOOL_NAME,
  createRunCodeTool,
  decodeInboundFrame,
  isJsonLossless,
  parseToolPresentationMode,
  renderToolsSdk,
  resolveCodeModeLimits,
  runCodeMode,
  runCodeProgram,
} from './code-mode/index.js';

export type {
  CodeDispatchRecord,
  CodeModeLimits,
  CodeModeOptions,
  CodeModeResult,
  CodeRunFailure,
  CodeRunFailureKind,
  DispatchOutcome,
  RunCodeToolOptions,
  ToolPresentationMode,
} from './code-mode/index.js';
