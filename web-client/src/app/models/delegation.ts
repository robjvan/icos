/** Mirrors core `Delegation` (delegation.repository.ts). */
export interface Delegation {
  readonly id: string;
  readonly parentSessionId: string;
  readonly childSessionId: string | null;
  readonly parentRunId: string | null;
  readonly goal: string;
  readonly state:
    | 'running'
    | 'awaiting_approval'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'budget_exhausted';
  readonly resultSummary: string | null;
  readonly error: string | null;
  readonly cancelRequested: boolean;
  readonly budgets: {
    readonly maxIterations: number;
    readonly maxToolSteps: number;
    readonly maxTurnDurationMs: number;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListDelegationsResponse {
  readonly delegations: Delegation[];
}
