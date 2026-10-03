/* eslint-disable @typescript-eslint/require-await --
   async is contractual (repository returns Promises);
   better-sqlite3 itself is synchronous. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { MemoryDatabaseService } from '../memory/memory-database.service';
import { HallucinationLedgerRepository } from './hallucination-ledger.repository';
import type {
  HallucinationMitigationEntry,
  RecordMitigationInput,
} from './hallucination-ledger.repository';
import type {
  HallucinationSeverity,
  MitigationStrategy,
} from './hallucination-modes';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface MitigationRow {
  id: string;
  severity: string;
  strategy: string;
  mode: string | null;
  reason: string;
  subject: string | null;
  detail_json: string | null;
  created_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value) as unknown;
    return parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function mapRow(row: MitigationRow): HallucinationMitigationEntry {
  return {
    id: row.id,
    severity: row.severity as HallucinationSeverity,
    strategy: row.strategy as MitigationStrategy,
    mode: row.mode,
    reason: row.reason,
    subject: row.subject,
    detail: parseJsonObject(row.detail_json),
    createdAt: row.created_at,
  };
}

@Injectable()
export class SqliteHallucinationLedgerRepository extends HallucinationLedgerRepository {
  constructor(private readonly databaseService: MemoryDatabaseService) {
    super();
  }

  private get database(): Database.Database {
    return this.databaseService.connection;
  }

  async record(
    input: RecordMitigationInput,
  ): Promise<HallucinationMitigationEntry> {
    const id = randomUUID();
    const now = input.occurredAt ?? nowIso();
    this.database
      .prepare(
        `INSERT INTO hallucination_mitigations (
           id, severity, strategy, mode, reason, subject, detail_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.severity,
        input.strategy,
        input.mode ?? null,
        input.reason,
        input.subject ?? null,
        input.detail ? JSON.stringify(input.detail) : '{}',
        now,
      );
    const row = this.database
      .prepare('SELECT * FROM hallucination_mitigations WHERE id = ?')
      .get(id) as MitigationRow | undefined;
    if (!row) throw new Error('Mitigation entry vanished after insert');
    return mapRow(row);
  }

  async list(limit = DEFAULT_LIMIT): Promise<HallucinationMitigationEntry[]> {
    const capped = Math.min(
      Math.max(Math.trunc(limit || DEFAULT_LIMIT), 1),
      MAX_LIMIT,
    );
    const rows = this.database
      .prepare(
        `SELECT * FROM hallucination_mitigations
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(capped) as MitigationRow[];
    return rows.map(mapRow);
  }

  async ping(): Promise<void> {
    this.database.prepare('SELECT 1').get();
  }
}
