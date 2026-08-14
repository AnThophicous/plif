export type HarnessPhase = 'plan' | 'work' | 'review' | 'complete';

export interface HarnessCycleState {
  readonly phase: HarnessPhase;
  readonly planReady: boolean;
  readonly revision: number;
  readonly changedPaths: readonly string[];
  readonly reviewedPaths: readonly string[];
  readonly validatedRevision: number | null;
}

export type CycleObservation =
  | { readonly type: 'plan_ready' }
  | { readonly type: 'mutation'; readonly paths: readonly string[] }
  | { readonly type: 'inspection'; readonly paths: readonly string[] }
  | { readonly type: 'validation' }
  | { readonly type: 'review_requested' }
  | { readonly type: 'complete' };

const FILE_MUTATION_TOOLS = new Set(['write_file', 'edit_file', 'apply_patch', 'resolve_edit_conflict']);
const REVIEW_INSPECTION_TOOLS = new Set(['read_file', 'diagnostics']);
const VALIDATION_WORDS = /\b(?:test|tests|typecheck|build|check|lint|verify|verification)\b/i;
const DIFF_COMMAND = /\bgit(?:\.exe)?\s+(?:diff|status)\b/i;

export function createHarnessCycle(): HarnessCycleState {
  return {
    phase: 'plan',
    planReady: false,
    revision: 0,
    changedPaths: [],
    reviewedPaths: [],
    validatedRevision: null,
  };
}

export function observeHarnessCycle(
  state: HarnessCycleState,
  observation: CycleObservation,
): HarnessCycleState {
  switch (observation.type) {
    case 'plan_ready':
      return { ...state, phase: 'work', planReady: true };
    case 'mutation': {
      const paths = normalizePaths(observation.paths);
      return {
        ...state,
        phase: 'work',
        revision: state.revision + 1,
        changedPaths: paths.length > 0 ? paths : ['*'],
        reviewedPaths: [],
        validatedRevision: null,
      };
    }
    case 'inspection': {
      if (state.revision === 0) return state;
      const paths = normalizePaths(observation.paths);
      const inspected =
        paths.includes('*') || (state.changedPaths.includes('*') && paths.length > 0)
          ? state.changedPaths
          : paths.filter((path) => state.changedPaths.includes(path));
      return {
        ...state,
        reviewedPaths: mergePaths(state.reviewedPaths, inspected),
      };
    }
    case 'validation':
      return state.revision === 0 ? state : { ...state, validatedRevision: state.revision };
    case 'review_requested':
      return state.revision === 0 ? state : { ...state, phase: 'review' };
    case 'complete':
      return reviewGate(state) === null ? { ...state, phase: 'complete' } : state;
  }
}

export function mutationGate(state: HarnessCycleState): string | null {
  return state.planReady
    ? null
    : 'Plan gate: call update_plan with the concise checkpoints before changing any file.';
}

export function reviewGate(state: HarnessCycleState): string | null {
  if (state.revision === 0) return null;

  const missing = state.changedPaths.filter((path) => !state.reviewedPaths.includes(path));
  if (missing.length > 0) {
    return (
      'Review gate: inspect every changed file before concluding. ' +
      `Still to inspect: ${missing.join(', ')}.`
    );
  }
  if (state.validatedRevision !== state.revision) {
    return (
      'Review gate: collect fresh validation evidence after the last change. ' +
      'Run diagnostics or the relevant tests, typecheck, build, lint, or verification command.'
    );
  }
  return null;
}

export function isFileMutationTool(name: string): boolean {
  return FILE_MUTATION_TOOLS.has(name);
}

export function mutationPaths(name: string, input: Record<string, unknown>): readonly string[] {
  if (name === 'resolve_edit_conflict') return ['*'];
  if (name === 'write_file' || name === 'edit_file') {
    return typeof input['path'] === 'string' && input['path'].trim() ? [input['path']] : ['*'];
  }
  if (name === 'apply_patch' && Array.isArray(input['edits'])) {
    const paths = input['edits'].flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const path = (value as Record<string, unknown>)['path'];
      return typeof path === 'string' && path.trim() ? [path] : [];
    });
    return paths.length > 0 ? paths : ['*'];
  }
  return [];
}

export function inspectionPaths(name: string, input: Record<string, unknown>): readonly string[] {
  if (REVIEW_INSPECTION_TOOLS.has(name)) {
    return typeof input['path'] === 'string' && input['path'].trim() ? [input['path']] : [];
  }

  const command = commandText(name, input);
  return DIFF_COMMAND.test(command) ? ['*'] : [];
}

export function isValidationObservation(name: string, input: Record<string, unknown>): boolean {
  if (name === 'diagnostics') return true;
  return (name === 'run_command' || name === 'shell_command') && VALIDATION_WORDS.test(commandText(name, input));
}

function commandText(name: string, input: Record<string, unknown>): string {
  if (name === 'run_command' && Array.isArray(input['argv'])) {
    return input['argv'].filter((value): value is string => typeof value === 'string').join(' ');
  }
  return typeof input['script'] === 'string' ? input['script'] : '';
}

function normalizePaths(paths: readonly string[]): string[] {
  return mergePaths([], paths);
}

function mergePaths(current: readonly string[], additions: readonly string[]): string[] {
  const merged = [...current];
  for (const path of additions) {
    const normalized = normalizePath(path);
    if (normalized && !merged.includes(normalized)) merged.push(normalized);
  }
  return merged;
}

function normalizePath(path: string): string {
  return path.trim().replaceAll('\\', '/').toLowerCase();
}
