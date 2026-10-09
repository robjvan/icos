/* eslint-disable @typescript-eslint/require-await --
   async is contractual (CronJobRepository returns Promises);
   better-sqlite3 itself is synchronous. */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SessionDatabaseService } from '../session/session-database.service';
import { CronJobRepository } from './cron-job.repository';
import type { CronDelivery, CronJob, NewCronJob } from './cron-job.repository';

interface Row {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  session_id: string | null;
  deliver_json: string | null;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class SqliteCronJobRepository extends CronJobRepository {
  constructor(private readonly database: SessionDatabaseService) {
    super();
  }

  async create(input: NewCronJob): Promise<CronJob> {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.database.connection
      .prepare(
        `INSERT INTO cron_jobs
          (id, name, schedule, prompt, session_id, deliver_json, enabled,
           last_run_at, next_run_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.schedule,
        input.prompt,
        input.sessionId ?? null,
        input.deliver ? JSON.stringify(input.deliver) : null,
        input.nextRunAt,
        now,
        now,
      );
    const created = await this.get(id);
    if (!created) throw new Error('cron_job_create_failed');
    return created;
  }

  async list(): Promise<CronJob[]> {
    const rows = this.database.connection
      .prepare('SELECT * FROM cron_jobs ORDER BY created_at DESC')
      .all() as Row[];
    return rows.map(toJob);
  }

  async get(id: string): Promise<CronJob | null> {
    const row = this.database.connection
      .prepare('SELECT * FROM cron_jobs WHERE id = ?')
      .get(id) as Row | undefined;
    return row ? toJob(row) : null;
  }

  async setEnabled(
    id: string,
    enabled: boolean,
    nextRunAt: string | null,
  ): Promise<CronJob | null> {
    const result = this.database.connection
      .prepare(
        'UPDATE cron_jobs SET enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ?',
      )
      .run(enabled ? 1 : 0, nextRunAt, new Date().toISOString(), id);
    return result.changes === 1 ? this.get(id) : null;
  }

  async remove(id: string): Promise<boolean> {
    return (
      this.database.connection
        .prepare('DELETE FROM cron_jobs WHERE id = ?')
        .run(id).changes === 1
    );
  }

  async recordRun(
    id: string,
    lastRunAt: string,
    nextRunAt: string | null,
  ): Promise<void> {
    this.database.connection
      .prepare(
        'UPDATE cron_jobs SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?',
      )
      .run(lastRunAt, nextRunAt, new Date().toISOString(), id);
  }

  async due(nowIso: string): Promise<CronJob[]> {
    const rows = this.database.connection
      .prepare(
        `SELECT * FROM cron_jobs
          WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
          ORDER BY next_run_at ASC`,
      )
      .all(nowIso) as Row[];
    return rows.map(toJob);
  }

  async ping(): Promise<void> {
    this.database.connection.prepare('SELECT 1').get();
  }
}

function toJob(row: Row): CronJob {
  return {
    id: row.id,
    name: row.name,
    schedule: row.schedule,
    prompt: row.prompt,
    sessionId: row.session_id,
    deliver: row.deliver_json
      ? (JSON.parse(row.deliver_json) as CronDelivery)
      : null,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
