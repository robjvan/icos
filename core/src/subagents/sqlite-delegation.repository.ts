/* eslint-disable @typescript-eslint/require-await --
   async is contractual (DelegationRepository returns Promises);
   better-sqlite3 itself is synchronous. */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SessionDatabaseService } from '../session/session-database.service';
import { DelegationRepository } from './delegation.repository';
import type {
  Delegation,
  DelegationBudgets,
  DelegationContext,
  DelegationState,
  NewDelegation,
} from './delegation.repository';

interface Row {
  id: string;
  parent_session_id: string;
  child_session_id: string | null;
  parent_run_id: string | null;
  goal: string;
  state: DelegationState;
  result_summary: string | null;
  error: string | null;
  cancel_requested: number;
  budgets_json: string;
  created_at: string;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toDelegation(row: Row): Delegation {
  return {
    id: row.id,
    parentSessionId: row.parent_session_id,
    childSessionId: row.child_session_id,
    parentRunId: row.parent_run_id,
    goal: row.goal,
    state: row.state,
    resultSummary: row.result_summary,
    error: row.error,
    cancelRequested: row.cancel_requested === 1,
    budgets: JSON.parse(row.budgets_json) as DelegationBudgets,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class SqliteDelegationRepository extends DelegationRepository {
  constructor(private readonly database: SessionDatabaseService) {
    super();
  }

  async create(input: NewDelegation): Promise<Delegation> {
    const now = nowIso();
    const id = randomUUID();
    this.database.connection
      .prepare(
        `INSERT INTO delegations
          (id, parent_session_id, child_session_id, parent_run_id, goal,
           state, result_summary, error, cancel_requested, budgets_json,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'running', NULL, NULL, 0, ?, ?, ?)`,
      )
      .run(
        id,
        input.parentSessionId,
        input.childSessionId,
        input.parentRunId,
        input.goal,
        JSON.stringify(input.budgets),
        now,
        now,
      );
    const created = await this.get(id);
    if (!created) throw new Error('delegation_create_failed');
    return created;
  }

  async get(id: string): Promise<Delegation | null> {
    const row = this.database.connection
      .prepare('SELECT * FROM delegations WHERE id = ?')
      .get(id) as Row | undefined;
    return row ? toDelegation(row) : null;
  }

  async listByParent(parentSessionId: string): Promise<Delegation[]> {
    const rows = this.database.connection
      .prepare(
        'SELECT * FROM delegations WHERE parent_session_id = ? ORDER BY created_at DESC',
      )
      .all(parentSessionId) as Row[];
    return rows.map(toDelegation);
  }

  async isChildSession(sessionId: string): Promise<boolean> {
    const row = this.database.connection
      .prepare('SELECT id FROM delegations WHERE child_session_id = ? LIMIT 1')
      .get(sessionId) as { id: string } | undefined;
    return row !== undefined;
  }

  async runningCount(): Promise<number> {
    const row = this.database.connection
      .prepare(
        `SELECT COUNT(*) AS n FROM delegations
         WHERE state IN ('running', 'awaiting_approval')`,
      )
      .get() as { n: number };
    return row.n;
  }

  async setState(
    id: string,
    state: DelegationState,
    patch?: { resultSummary?: string; error?: string },
  ): Promise<Delegation | null> {
    const current = await this.get(id);
    if (!current) return null;
    this.database.connection
      .prepare(
        `UPDATE delegations SET state = ?, result_summary = ?,
         error = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        state,
        patch?.resultSummary ?? current.resultSummary,
        patch?.error ?? current.error,
        nowIso(),
        id,
      );
    return this.get(id);
  }

  async requestCancel(id: string): Promise<Delegation | null> {
    const current = await this.get(id);
    if (!current) return null;
    // Terminal delegations stay terminal — cancelling a finished child is a
    // no-op, never a state regression.
    if (
      current.state === 'completed' ||
      current.state === 'failed' ||
      current.state === 'cancelled' ||
      current.state === 'budget_exhausted'
    ) {
      return current;
    }
    this.database.connection
      .prepare(
        'UPDATE delegations SET cancel_requested = 1, updated_at = ? WHERE id = ?',
      )
      .run(nowIso(), id);
    return this.get(id);
  }

  async isCancelRequested(sessionId: string): Promise<boolean> {
    const row = this.database.connection
      .prepare(
        `SELECT cancel_requested FROM delegations
         WHERE child_session_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(sessionId) as { cancel_requested: number } | undefined;
    return row !== undefined && row.cancel_requested === 1;
  }

  async failNonTerminal(reason: string): Promise<string[]> {
    const rows = this.database.connection
      .prepare(
        `SELECT id FROM delegations
         WHERE state IN ('running', 'awaiting_approval')`,
      )
      .all() as { id: string }[];
    const now = nowIso();
    const mark = this.database.connection.prepare(
      `UPDATE delegations SET state = 'failed', error = ?,
       updated_at = ? WHERE id = ?`,
    );
    for (const row of rows) mark.run(reason, now, row.id);
    return rows.map((row) => row.id);
  }

  async contextForChild(
    childSessionId: string,
  ): Promise<DelegationContext | null> {
    const row = this.database.connection
      .prepare(
        `SELECT id, goal, parent_session_id FROM delegations
         WHERE child_session_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(childSessionId) as
      | { id: string; goal: string; parent_session_id: string }
      | undefined;
    return row
      ? {
          taskId: row.id,
          goal: row.goal,
          parentSessionId: row.parent_session_id,
        }
      : null;
  }

  async unnotifiedTerminal(
    parentSessionId: string,
    limit: number,
  ): Promise<Delegation[]> {
    if (limit <= 0) return [];
    const rows = this.database.connection
      .prepare(
        `SELECT * FROM delegations
         WHERE parent_session_id = ?
           AND notified_at IS NULL
           AND state IN ('completed', 'failed', 'cancelled', 'budget_exhausted')
         ORDER BY updated_at ASC LIMIT ?`,
      )
      .all(parentSessionId, limit) as Row[];
    return rows.map(toDelegation);
  }

  async markNotified(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = nowIso();
    const mark = this.database.connection.prepare(
      'UPDATE delegations SET notified_at = ? WHERE id = ?',
    );
    for (const id of ids) mark.run(now, id);
  }
}
