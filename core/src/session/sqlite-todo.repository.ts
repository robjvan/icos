/* eslint-disable @typescript-eslint/require-await --
   async is contractual (TodoRepository returns Promises);
   better-sqlite3 itself is synchronous. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { SessionDatabaseService } from './session-database.service';
import { TodoRepository } from './todo.repository';
import type { Todo, TodoStatus } from './todo.repository';

interface TodoRow {
  id: string;
  session_id: string;
  text: string;
  status: TodoStatus;
  created_at: string;
  updated_at: string;
}

function mapRow(row: TodoRow): Todo {
  return {
    id: row.id,
    sessionId: row.session_id,
    text: row.text,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

const COLUMNS = 'id, session_id, text, status, created_at, updated_at';

@Injectable()
export class SqliteTodoRepository extends TodoRepository {
  constructor(private readonly databaseService: SessionDatabaseService) {
    super();
  }

  private get database(): Database.Database {
    return this.databaseService.connection;
  }

  async list(sessionId: string): Promise<Todo[]> {
    const rows = this.database
      .prepare(
        `SELECT ${COLUMNS} FROM session_todos
          WHERE session_id = ? ORDER BY created_at, id`,
      )
      .all(sessionId) as TodoRow[];
    return rows.map(mapRow);
  }

  async add(sessionId: string, text: string): Promise<Todo> {
    const id = randomUUID();
    const now = nowIso();
    this.database
      .prepare(
        `INSERT INTO session_todos
           (id, session_id, text, status, created_at, updated_at)
         VALUES (?, ?, ?, 'open', ?, ?)`,
      )
      .run(id, sessionId, text, now, now);
    return {
      id,
      sessionId,
      text,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    };
  }

  async complete(sessionId: string, id: string): Promise<Todo | null> {
    const now = nowIso();
    const result = this.database
      .prepare(
        `UPDATE session_todos SET status = 'done', updated_at = ?
          WHERE session_id = ? AND id = ? AND status = 'open'`,
      )
      .run(now, sessionId, id);
    if (result.changes === 0) return null;
    const row = this.database
      .prepare(`SELECT ${COLUMNS} FROM session_todos WHERE id = ?`)
      .get(id) as TodoRow | undefined;
    return row ? mapRow(row) : null;
  }

  async remove(sessionId: string, id: string): Promise<boolean> {
    const result = this.database
      .prepare('DELETE FROM session_todos WHERE session_id = ? AND id = ?')
      .run(sessionId, id);
    return result.changes > 0;
  }

  async clear(sessionId: string): Promise<number> {
    const result = this.database
      .prepare('DELETE FROM session_todos WHERE session_id = ?')
      .run(sessionId);
    return result.changes;
  }
}
