/**
 * M21.1 async subagent delegation records. One row per spawned child: the
 * parent session/run that delegated, the child's own (fresh, isolated)
 * session, the goal, terminal state, and the bounded result summary.
 *
 * The child turn itself writes normal `agent_runs` rows under the child
 * session id — this store only tracks the delegation lifecycle, so the
 * invocation ledger stays the single authority on execution.
 */
export type DelegationState =
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'budget_exhausted';

export type DelegationTerminalState = Extract<
  DelegationState,
  'completed' | 'failed' | 'cancelled' | 'budget_exhausted'
>;

export interface DelegationBudgets {
  maxIterations: number;
  maxToolSteps: number;
  maxTurnDurationMs: number;
}

export interface Delegation {
  id: string;
  parentSessionId: string;
  childSessionId: string | null;
  parentRunId: string | null;
  goal: string;
  state: DelegationState;
  resultSummary: string | null;
  error: string | null;
  cancelRequested: boolean;
  budgets: DelegationBudgets;
  createdAt: string;
  updatedAt: string;
}

export interface NewDelegation {
  parentSessionId: string;
  childSessionId: string;
  parentRunId: string | null;
  goal: string;
  budgets: DelegationBudgets;
}

export abstract class DelegationRepository {
  abstract create(input: NewDelegation): Promise<Delegation>;
  abstract get(id: string): Promise<Delegation | null>;
  abstract listByParent(parentSessionId: string): Promise<Delegation[]>;
  abstract isChildSession(sessionId: string): Promise<boolean>;
  abstract runningCount(): Promise<number>;
  abstract setState(
    id: string,
    state: DelegationState,
    patch?: { resultSummary?: string; error?: string },
  ): Promise<Delegation | null>;
  abstract requestCancel(id: string): Promise<Delegation | null>;
  abstract isCancelRequested(sessionId: string): Promise<boolean>;
  /**
   * Honest restart recovery: every non-terminal delegation is failed with
   * the given reason (a restart orphans the background promise — the process
   * registry sets the same precedent). Returns the marked ids.
   */
  abstract failNonTerminal(reason: string): Promise<string[]>;
}
