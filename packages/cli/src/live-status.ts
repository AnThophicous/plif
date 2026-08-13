export interface LiveStatusInputs {
  readonly approval?: boolean;
  readonly question?: boolean;
  readonly agent: boolean;
  readonly compacting: boolean;
  readonly mcp: string | null;
  readonly background?: string | boolean;
  readonly queued: number;
}

export type LiveStatusKind =
  | 'approval'
  | 'question'
  | 'agent'
  | 'compaction'
  | 'mcp'
  | 'background'
  | 'idle';

export interface LiveStatus {
  readonly kind: LiveStatusKind;
  readonly label: string;
  readonly interruptible: boolean;
  readonly queued: number;
}

export interface PlifDockFacts {
  readonly workspace: string;
  readonly model: string | null;
  readonly effort?: string;
  readonly contextUsed: number;
  readonly contextMax: number;
  readonly working: boolean;
}

export type PlifDockItem = 'workspace' | 'model' | 'effort' | 'context' | 'working';

/** Stable dock collapse order: action first, ambient facts only when they fit. */
export function plifDockItems(width: number, facts: PlifDockFacts): readonly PlifDockItem[] {
  if (width < 32) return facts.working ? ['working'] : ['context'];
  if (width < 64) return ['workspace', 'context', ...(facts.working ? ['working' as const] : [])];
  return [
    'workspace',
    ...(facts.model ? ['model' as const] : []),
    ...(facts.effort ? ['effort' as const] : []),
    'context',
    ...(facts.working ? ['working' as const] : []),
  ];
}

/** One authoritative global state, ordered by what requires attention first. */
export function deriveLiveStatus(input: LiveStatusInputs): LiveStatus {
  const shared = { queued: input.queued };
  if (input.approval) {
    return { kind: 'approval', label: 'Approval required', interruptible: false, ...shared };
  }
  if (input.question) {
    return { kind: 'question', label: 'Answer required', interruptible: true, ...shared };
  }
  if (input.agent) {
    return { kind: 'agent', label: 'Working', interruptible: true, ...shared };
  }
  if (input.compacting) {
    return { kind: 'compaction', label: 'Compacting context', interruptible: true, ...shared };
  }
  if (input.mcp) {
    const label = input.mcp[0]?.toUpperCase() + input.mcp.slice(1);
    return { kind: 'mcp', label, interruptible: false, ...shared };
  }
  if (input.background) {
    return {
      kind: 'background',
      label: typeof input.background === 'string' ? input.background : 'Background work',
      interruptible: true,
      ...shared,
    };
  }
  return { kind: 'idle', label: 'Ready', interruptible: false, ...shared };
}
