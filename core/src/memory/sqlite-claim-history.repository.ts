/* eslint-disable @typescript-eslint/require-await --
   async is contractual (repository returns Promises);
   better-sqlite3 itself is synchronous. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type {
  ClaimHistory,
  ClaimTransition,
  NewClaimHistory,
} from './claim-history';
import { CLAIM_TRANSITIONS } from './claim-history';
import { ClaimHistoryRepository } from './claim-history.repository';
import { MemoryDatabaseService } from './memory-database.service';

function nowIso(): string {
  return new Date().toISOString();
}

interface HistoryRow {
  id: string;
  claim_id: string;
  transition: string;
  detail_json: string;
  confidence_before: number | null;
  confidence_after: number | null;
  created_at: string;
}

function parseDetail(json: string, id: string): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch {
    throw new Error(`Claim history ${id} has corrupt detail_json`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`Claim history ${id} has corrupt detail_json`);
  }
  return raw as Record<string, unknown>;
}

function toHistory(row: HistoryRow): ClaimHistory {
  if (!(CLAIM_TRANSITIONS as readonly string[]).includes(row.transition)) {
    throw new Error(`Claim history ${row.id} has unknown transition`);
  }
  return {
    id: row.id,
    claimId: row.claim_id,
    transition: row.transition as ClaimTransition,
    detail: parseDetail(row.detail_json, row.id),
    confidenceBefore: row.confidence_before,
    confidenceAfter: row.confidence_after,
    createdAt: row.created_at,
  };
}

@Injectable()
export class SqliteClaimHistoryRepository extends ClaimHistoryRepository {
  constructor(private readonly databaseService: MemoryDatabaseService) {
    super();
  }

  private get database(): Database.Database {
    return this.databaseService.connection;
  }

  async record(entry: NewClaimHistory): Promise<ClaimHistory> {
    const id = randomUUID();
    const now = nowIso();
    this.database
      .prepare(
        `INSERT INTO claim_history
           (id, claim_id, transition, detail_json,
            confidence_before, confidence_after, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        entry.claimId,
        entry.transition,
        JSON.stringify(entry.detail),
        entry.confidenceBefore,
        entry.confidenceAfter,
        now,
      );
    const row = this.database
      .prepare('SELECT * FROM claim_history WHERE id = ?')
      .get(id) as HistoryRow | undefined;
    if (!row) throw new Error(`Claim history ${id} vanished after insert`);
    return toHistory(row);
  }

  async listByClaimId(claimId: string): Promise<ClaimHistory[]> {
    const rows = this.database
      .prepare(
        'SELECT * FROM claim_history WHERE claim_id = ? ORDER BY rowid ASC',
      )
      .all(claimId) as HistoryRow[];
    return rows.map(toHistory);
  }

  async latestByClaimAndTransition(
    claimId: string,
    transition: ClaimTransition,
  ): Promise<ClaimHistory | null> {
    const row = this.database
      .prepare(
        `SELECT * FROM claim_history
          WHERE claim_id = ? AND transition = ?
          ORDER BY rowid DESC LIMIT 1`,
      )
      .get(claimId, transition) as HistoryRow | undefined;
    return row ? toHistory(row) : null;
  }

  async ping(): Promise<void> {
    this.database.prepare('SELECT 1').get();
  }
}
