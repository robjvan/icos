/* eslint-disable @typescript-eslint/require-await --
   async is contractual (repository returns Promises);
   better-sqlite3 itself is synchronous. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type {
  NewProspectiveItem,
  ProspectiveItem,
  ProspectiveOption,
  ProspectiveResolution,
  ProspectiveStatus,
  ProspectiveTrigger,
} from './prospective-item';
import {
  PROSPECTIVE_RESOLUTIONS,
  PROSPECTIVE_STATUSES,
  PROSPECTIVE_TRIGGERS,
} from './prospective-item';
import { normalizeTripleField } from './claim-identity';
import { ProspectiveItemRepository } from './prospective-item.repository';
import { MemoryDatabaseService } from './memory-database.service';

const MAX_LIST_LIMIT = 200;

function nowIso(): string {
  return new Date().toISOString();
}

interface ProspectiveRow {
  id: string;
  subject: string;
  predicate: string;
  options_json: string;
  contest_count: number;
  trigger: string;
  suggested_question: string;
  status: string;
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

function parseOptions(json: string, id: string): ProspectiveOption[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch {
    throw new Error(`Prospective item ${id} has corrupt options_json`);
  }
  if (!Array.isArray(raw)) {
    throw new Error(`Prospective item ${id} has corrupt options_json`);
  }
  return raw.map((item) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as { object?: unknown }).object !== 'string' ||
      typeof (item as { claimId?: unknown }).claimId !== 'string' ||
      typeof (item as { confidence?: unknown }).confidence !== 'number'
    ) {
      throw new Error(`Prospective item ${id} has corrupt options_json`);
    }
    const origin = (item as { origin?: unknown }).origin;
    if (origin !== 'user' && origin !== 'agent') {
      throw new Error(`Prospective item ${id} has corrupt options_json`);
    }
    const option = item as {
      object: string;
      claimId: string;
      confidence: number;
    };
    return {
      object: option.object,
      origin,
      confidence: option.confidence,
      claimId: option.claimId,
    };
  });
}

function toItem(row: ProspectiveRow): ProspectiveItem {
  if (!(PROSPECTIVE_TRIGGERS as readonly string[]).includes(row.trigger)) {
    throw new Error(`Prospective item ${row.id} has unknown trigger`);
  }
  if (!(PROSPECTIVE_STATUSES as readonly string[]).includes(row.status)) {
    throw new Error(`Prospective item ${row.id} has unknown status`);
  }
  if (
    row.resolution !== null &&
    !(PROSPECTIVE_RESOLUTIONS as readonly string[]).includes(row.resolution)
  ) {
    throw new Error(`Prospective item ${row.id} has unknown resolution`);
  }
  return {
    id: row.id,
    subject: row.subject,
    predicate: row.predicate,
    options: parseOptions(row.options_json, row.id),
    contestCount: row.contest_count,
    trigger: row.trigger as ProspectiveTrigger,
    suggestedQuestion: row.suggested_question,
    status: row.status as ProspectiveStatus,
    resolution: row.resolution,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class SqliteProspectiveItemRepository extends ProspectiveItemRepository {
  constructor(private readonly databaseService: MemoryDatabaseService) {
    super();
  }

  private get database(): Database.Database {
    return this.databaseService.connection;
  }

  private rowById(id: string): ProspectiveRow | undefined {
    return this.database
      .prepare('SELECT * FROM prospective_items WHERE id = ?')
      .get(id) as ProspectiveRow | undefined;
  }

  async create(item: NewProspectiveItem): Promise<ProspectiveItem> {
    const id = randomUUID();
    const now = nowIso();
    this.database
      .prepare(
        `INSERT INTO prospective_items
           (id, subject, predicate, subject_norm, predicate_norm,
            options_json, contest_count, trigger, suggested_question,
            status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      )
      .run(
        id,
        item.subject,
        item.predicate,
        normalizeTripleField(item.subject),
        normalizeTripleField(item.predicate),
        JSON.stringify(item.options),
        item.contestCount,
        item.trigger,
        item.suggestedQuestion,
        now,
        now,
      );
    const row = this.rowById(id);
    if (!row) throw new Error(`Prospective item ${id} vanished after insert`);
    return toItem(row);
  }

  async getItem(id: string): Promise<ProspectiveItem | null> {
    const row = this.rowById(id);
    return row ? toItem(row) : null;
  }

  async findOpenBySubjectPredicate(
    subject: string,
    predicate: string,
  ): Promise<ProspectiveItem | null> {
    const row = this.database
      .prepare(
        `SELECT * FROM prospective_items
          WHERE subject_norm = ? AND predicate_norm = ? AND status = 'open'
          ORDER BY rowid DESC LIMIT 1`,
      )
      .get(normalizeTripleField(subject), normalizeTripleField(predicate)) as
      ProspectiveRow | undefined;
    return row ? toItem(row) : null;
  }

  async mergeContest(
    id: string,
    options: ProspectiveOption[],
    trigger: ProspectiveTrigger,
    suggestedQuestion: string,
  ): Promise<ProspectiveItem | null> {
    const row = this.rowById(id);
    if (!row) return null;
    const current = toItem(row);
    const seen = new Set(current.options.map((item) => item.claimId));
    const merged = [
      ...current.options,
      ...options.filter((item) => !seen.has(item.claimId)),
    ];
    this.database
      .prepare(
        `UPDATE prospective_items
            SET options_json = ?, contest_count = contest_count + 1,
                trigger = ?, suggested_question = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(JSON.stringify(merged), trigger, suggestedQuestion, nowIso(), id);
    const updated = this.rowById(id);
    if (!updated) throw new Error(`Prospective item ${id} vanished`);
    return toItem(updated);
  }

  async resolve(
    id: string,
    outcome: ProspectiveResolution,
  ): Promise<ProspectiveItem | null> {
    if (!(PROSPECTIVE_RESOLUTIONS as readonly string[]).includes(outcome)) {
      return null;
    }
    const row = this.rowById(id);
    if (!row) return null;
    const current = toItem(row);
    if (current.status !== 'open') return null;
    const now = nowIso();
    this.database
      .prepare(
        `UPDATE prospective_items
            SET status = 'dismissed', resolution = ?, resolved_at = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(outcome, now, now, id);
    const updated = this.rowById(id);
    if (!updated) throw new Error(`Prospective item ${id} vanished`);
    return toItem(updated);
  }

  async listItems(options?: {
    status?: ProspectiveStatus;
    limit?: number;
  }): Promise<ProspectiveItem[]> {
    const limit = Math.min(options?.limit ?? 50, MAX_LIST_LIMIT);
    const sql =
      options?.status !== undefined
        ? `SELECT * FROM prospective_items WHERE status = ?
           ORDER BY rowid DESC LIMIT ?`
        : `SELECT * FROM prospective_items ORDER BY rowid DESC LIMIT ?`;
    const params =
      options?.status !== undefined ? [options.status, limit] : [limit];
    const rows = this.database.prepare(sql).all(...params) as ProspectiveRow[];
    return rows.map(toItem);
  }

  async ping(): Promise<void> {
    this.database.prepare('SELECT 1').get();
  }
}
