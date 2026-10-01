/* eslint-disable @typescript-eslint/require-await --
   async is contractual (repository returns Promises);
   better-sqlite3 itself is synchronous. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type {
  Claim,
  ClaimCategory,
  ClaimEvidence,
  ClaimOrigin,
  ClaimStatus,
  NewClaim,
} from './claim';
import { CLAIM_STATUSES } from './claim';
import {
  identityKey,
  normalizeTripleField,
  type Triple,
} from './claim-identity';
import { ClaimRepository } from './claim.repository';
import { MemoryDatabaseService } from './memory-database.service';

const MAX_LIST_LIMIT = 200;

function nowIso(): string {
  return new Date().toISOString();
}

const ALLOWED_TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  candidate: ['active', 'retired'],
  active: ['contradicted', 'retired'],
  contradicted: ['retired'],
  retired: [],
};

interface ClaimRow {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  category: string;
  status: string;
  extractor_confidence: number;
  confidence: number;
  first_asserted_at: string;
  last_surfaced_at: string;
  origin: string;
  negated: number;
  source_type: string | null;
  summary: string | null;
  evidence_json: string;
  related_json: string;
  entities_json: string;
  times_observed: number;
  access_count: number;
  last_accessed_at: string | null;
  activation: number | null;
  locked: number;
  emotional_json: string | null;
  promotion: string;
  created_at: string;
  updated_at: string;
}

function parseEvidence(json: string, id: string): ClaimEvidence[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch {
    throw new Error(`Claim ${id} has corrupt evidence_json`);
  }
  if (!Array.isArray(raw)) {
    throw new Error(`Claim ${id} has corrupt evidence_json`);
  }
  return raw.map((item) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as { candidateId?: unknown }).candidateId !== 'string'
    ) {
      throw new Error(`Claim ${id} has corrupt evidence_json`);
    }
    const role = (item as { role?: unknown }).role;
    return {
      candidateId: (item as { candidateId: string }).candidateId,
      role: role === 'user' || role === 'assistant' ? role : 'unknown',
    };
  });
}

function parseStringArray(json: string, id: string, field: string): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch {
    throw new Error(`Claim ${id} has corrupt ${field}`);
  }
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) {
    throw new Error(`Claim ${id} has corrupt ${field}`);
  }
  return raw as string[];
}

function toClaim(row: ClaimRow): Claim {
  if (!(CLAIM_STATUSES as readonly string[]).includes(row.status)) {
    throw new Error(`Claim ${row.id} has unknown status "${row.status}"`);
  }
  return {
    id: row.id,
    subject: row.subject,
    predicate: row.predicate,
    object: row.object,
    category: row.category as ClaimCategory,
    status: row.status as ClaimStatus,
    extractorConfidence: row.extractor_confidence,
    confidence: row.confidence,
    firstAssertedAt: row.first_asserted_at,
    lastSurfacedAt: row.last_surfaced_at,
    origin: row.origin as ClaimOrigin,
    // Pre-M10e claim rows carry no marker; absence reads affirmed.
    negated: row.negated !== 0,
    sourceType: row.source_type,
    summary: row.summary,
    evidence: parseEvidence(row.evidence_json, row.id),
    related: parseStringArray(row.related_json, row.id, 'related_json'),
    entities: parseStringArray(row.entities_json, row.id, 'entities_json'),
    timesObserved: row.times_observed,
    accessCount: row.access_count,
    lastAccessedAt: row.last_accessed_at,
    activation: row.activation,
    locked: row.locked !== 0,
    emotional: row.emotional_json,
    promotion: row.promotion,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class SqliteClaimRepository extends ClaimRepository {
  constructor(private readonly databaseService: MemoryDatabaseService) {
    super();
  }

  private get database(): Database.Database {
    return this.databaseService.connection;
  }

  private rowById(id: string): ClaimRow | undefined {
    return this.database
      .prepare('SELECT * FROM claims WHERE id = ?')
      .get(id) as ClaimRow | undefined;
  }

  async createClaim(claim: NewClaim): Promise<Claim> {
    const id = randomUUID();
    const now = nowIso();
    const key = identityKey(claim);
    const negated = claim.negated ? 1 : 0;
    const existing = this.database
      .prepare('SELECT id FROM claims WHERE identity_key = ? AND negated = ?')
      .get(key, negated) as { id: string } | undefined;
    if (existing) {
      throw new Error(
        `Claim identity already exists (${existing.id}); ` +
          `append evidence instead of creating a duplicate`,
      );
    }
    this.database
      .prepare(
        `INSERT INTO claims
           (id, subject, predicate, object, identity_key,
            subject_norm, predicate_norm,
            category, status,
            extractor_confidence, confidence,
            first_asserted_at, last_surfaced_at, origin, negated,
            evidence_json, entities_json, promotion,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        claim.subject,
        claim.predicate,
        claim.object,
        key,
        normalizeTripleField(claim.subject),
        normalizeTripleField(claim.predicate),
        claim.category,
        claim.status,
        claim.extractorConfidence,
        claim.confidence,
        claim.firstAssertedAt,
        claim.lastSurfacedAt,
        claim.origin,
        negated,
        JSON.stringify(claim.evidence),
        JSON.stringify(claim.entities),
        claim.promotion,
        now,
        now,
      );
    const row = this.rowById(id);
    if (!row) throw new Error(`Claim ${id} vanished after insert`);
    return toClaim(row);
  }

  async getClaim(id: string): Promise<Claim | null> {
    const row = this.rowById(id);
    return row ? toClaim(row) : null;
  }

  async findByTriple(
    triple: Triple & { negated?: boolean },
  ): Promise<Claim | null> {
    const row = this.database
      .prepare('SELECT * FROM claims WHERE identity_key = ? AND negated = ?')
      .get(identityKey(triple), triple.negated ? 1 : 0) as ClaimRow | undefined;
    return row ? toClaim(row) : null;
  }

  async findBySubjectPredicate(
    subject: string,
    predicate: string,
  ): Promise<Claim[]> {
    const rows = this.database
      .prepare(
        `SELECT * FROM claims
          WHERE subject_norm = ? AND predicate_norm = ?
          ORDER BY rowid DESC`,
      )
      .all(
        normalizeTripleField(subject),
        normalizeTripleField(predicate),
      ) as ClaimRow[];
    return rows.map(toClaim);
  }

  async appendEvidence(
    id: string,
    evidence: ClaimEvidence[],
    confidence: number,
  ): Promise<Claim | null> {
    const row = this.rowById(id);
    if (!row) return null;
    const current = toClaim(row);
    const seen = new Set(current.evidence.map((item) => item.candidateId));
    const merged = [
      ...current.evidence,
      ...evidence.filter((item) => !seen.has(item.candidateId)),
    ];
    const lastSurfacedAt =
      evidence.at(-1)?.candidateId ?? current.lastSurfacedAt;
    this.database
      .prepare(
        `UPDATE claims
            SET evidence_json = ?, last_surfaced_at = ?, confidence = ?,
                times_observed = times_observed + 1, updated_at = ?
          WHERE id = ?`,
      )
      .run(JSON.stringify(merged), lastSurfacedAt, confidence, nowIso(), id);
    const updated = this.rowById(id);
    if (!updated) throw new Error(`Claim ${id} vanished during update`);
    return toClaim(updated);
  }

  async setStatus(id: string, status: ClaimStatus): Promise<Claim | null> {
    const row = this.rowById(id);
    if (!row) return null;
    const current = toClaim(row);
    if (current.status === status) return current;
    if (!ALLOWED_TRANSITIONS[current.status].includes(status)) {
      return null;
    }
    this.database
      .prepare('UPDATE claims SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, nowIso(), id);
    const updated = this.rowById(id);
    if (!updated) throw new Error(`Claim ${id} vanished during update`);
    return toClaim(updated);
  }

  async recordAccessed(ids: string[]): Promise<void> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const placeholders = unique.map(() => '?').join(', ');
    this.database
      .prepare(
        `UPDATE claims
            SET access_count = access_count + 1,
                last_accessed_at = ?,
                updated_at = ?
          WHERE id IN (${placeholders})`,
      )
      .run(nowIso(), nowIso(), ...unique);
  }

  async adjustConfidence(
    id: string,
    confidence: number,
  ): Promise<Claim | null> {
    const row = this.rowById(id);
    if (!row) return null;
    this.database
      .prepare('UPDATE claims SET confidence = ?, updated_at = ? WHERE id = ?')
      .run(confidence, nowIso(), id);
    const updated = this.rowById(id);
    if (!updated) throw new Error(`Claim ${id} vanished during update`);
    return toClaim(updated);
  }

  async setLocked(id: string, locked: boolean): Promise<Claim | null> {
    const row = this.rowById(id);
    if (!row) return null;
    this.database
      .prepare('UPDATE claims SET locked = ?, updated_at = ? WHERE id = ?')
      .run(locked ? 1 : 0, nowIso(), id);
    const updated = this.rowById(id);
    if (!updated) throw new Error(`Claim ${id} vanished during update`);
    return toClaim(updated);
  }

  async setSourceType(id: string, sourceType: string): Promise<Claim | null> {
    const row = this.rowById(id);
    if (!row) return null;
    this.database
      .prepare('UPDATE claims SET source_type = ?, updated_at = ? WHERE id = ?')
      .run(sourceType, nowIso(), id);
    const updated = this.rowById(id);
    if (!updated) throw new Error(`Claim ${id} vanished during update`);
    return toClaim(updated);
  }

  async addRelated(id: string, relatedIds: string[]): Promise<Claim | null> {
    const row = this.rowById(id);
    if (!row) return null;
    const current = toClaim(row);
    const merged = [...current.related];
    for (const relatedId of relatedIds) {
      if (relatedId !== id && !merged.includes(relatedId)) {
        merged.push(relatedId);
      }
    }
    if (merged.length === current.related.length) return current;
    this.database
      .prepare(
        'UPDATE claims SET related_json = ?, updated_at = ? WHERE id = ?',
      )
      .run(JSON.stringify(merged), nowIso(), id);
    const updated = this.rowById(id);
    if (!updated) throw new Error(`Claim ${id} vanished during update`);
    return toClaim(updated);
  }

  async listClaims(options?: {
    status?: ClaimStatus;
    category?: ClaimCategory;
    origin?: ClaimOrigin;
    limit?: number;
  }): Promise<Claim[]> {
    const limit = Math.min(options?.limit ?? 50, MAX_LIST_LIMIT);
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (options?.status !== undefined) {
      clauses.push('status = ?');
      params.push(options.status);
    }
    if (options?.category !== undefined) {
      clauses.push('category = ?');
      params.push(options.category);
    }
    if (options?.origin !== undefined) {
      clauses.push('origin = ?');
      params.push(options.origin);
    }
    params.push(limit);
    const sql =
      `SELECT * FROM claims` +
      (clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '') +
      ` ORDER BY rowid DESC LIMIT ?`;
    const rows = this.database.prepare(sql).all(...params) as ClaimRow[];
    return rows.map(toClaim);
  }

  async ping(): Promise<void> {
    this.database.prepare('SELECT 1').get();
  }
}
