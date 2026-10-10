/* eslint-disable @typescript-eslint/require-await --
   async is contractual (repository returns Promises);
   better-sqlite3 itself is synchronous. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { MemoryCandidateRepository } from './memory-candidate.repository';
import type { CandidateSort } from './memory-candidate.repository';
import { MemoryDatabaseService } from './memory-database.service';
import type { MemoryCandidate, NewMemoryCandidate } from './memory-candidate';

const MAX_LIST_LIMIT = 200;

/** Fixed ORDER BY per sort key (M20g); never interpolated from user input. */
const ORDER_BY: Record<CandidateSort, string> = {
  recent: 'rowid DESC',
  confidence: 'confidence DESC, rowid DESC',
  importance: 'importance DESC, rowid DESC',
  stability: 'stability DESC, rowid DESC',
};

function nowIso(): string {
  return new Date().toISOString();
}

interface CandidateRow {
  id: string;
  session_id: string;
  message_id: number;
  kind: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  importance: number;
  stability: number;
  extractor_model: string;
  extractor_version: string;
  extracted_at: string;
  source_role: string;
  negated: number;
}

function toCandidate(row: CandidateRow): MemoryCandidate {
  const role = row.source_role;
  return {
    id: row.id,
    kind: row.kind as MemoryCandidate['kind'],
    subject: row.subject,
    predicate: row.predicate,
    object: row.object,
    confidence: row.confidence,
    importance: row.importance,
    stability: row.stability,
    sourceRole: role === 'user' || role === 'assistant' ? role : 'unknown',
    // Pre-M10e ledger rows carry no marker; absence reads affirmed.
    negated: row.negated !== 0,
    source: {
      sessionId: row.session_id,
      messageId: row.message_id,
      role: role === 'user' || role === 'assistant' ? role : 'unknown',
    },
    extractorModel: row.extractor_model,
    extractorVersion: row.extractor_version,
    extractedAt: row.extracted_at,
  };
}

@Injectable()
export class SqliteMemoryCandidateRepository extends MemoryCandidateRepository {
  constructor(private readonly databaseService: MemoryDatabaseService) {
    super();
  }

  private get database(): Database.Database {
    return this.databaseService.connection;
  }

  async saveCandidates(
    candidates: NewMemoryCandidate[],
  ): Promise<MemoryCandidate[]> {
    if (candidates.length === 0) return [];
    const extractedAt = nowIso();
    const insert = this.database.prepare(
      `INSERT INTO memory_candidates
         (id, session_id, message_id, kind, subject, predicate, object,
          confidence, importance, stability,
          extractor_model, extractor_version, extracted_at, source_role,
          negated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const saveAll = this.database.transaction(
      (items: NewMemoryCandidate[]): MemoryCandidate[] =>
        items.map((item) => {
          const id = randomUUID();
          insert.run(
            id,
            item.source.sessionId,
            item.source.messageId,
            item.kind,
            item.subject,
            item.predicate,
            item.object,
            item.confidence,
            item.importance,
            item.stability,
            item.extractorModel,
            item.extractorVersion,
            extractedAt,
            item.source.role,
            item.negated ? 1 : 0,
          );
          return { ...item, id, extractedAt };
        }),
    );
    return saveAll(candidates);
  }

  async getCandidate(id: string): Promise<MemoryCandidate | null> {
    const row = this.database
      .prepare(
        `SELECT id, session_id, message_id, kind, subject, predicate, object,
                confidence, importance, stability,
                extractor_model, extractor_version, extracted_at, source_role,
                negated
           FROM memory_candidates WHERE id = ?`,
      )
      .get(id) as CandidateRow | undefined;
    return row ? toCandidate(row) : null;
  }

  async listCandidates(
    sessionId?: string,
    options?: { limit?: number; sort?: CandidateSort },
  ): Promise<MemoryCandidate[]> {
    const limit = Math.min(options?.limit ?? 50, MAX_LIST_LIMIT);
    const orderBy = ORDER_BY[options?.sort ?? 'recent'];
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (sessionId !== undefined) {
      clauses.push('session_id = ?');
      params.push(sessionId);
    }
    params.push(limit);
    const sql =
      `SELECT id, session_id, message_id, kind, subject, predicate, object,
              confidence, importance, stability,
              extractor_model, extractor_version, extracted_at, source_role,
              negated
         FROM memory_candidates` +
      (clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '') +
      ` ORDER BY ${orderBy} LIMIT ?`;
    const rows = this.database.prepare(sql).all(...params) as CandidateRow[];
    return rows.map(toCandidate);
  }

  async ping(): Promise<void> {
    this.database.prepare('SELECT 1').get();
  }
}
