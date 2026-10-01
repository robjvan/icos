/* eslint-disable @typescript-eslint/require-await --
   async is contractual (repository returns Promises);
   better-sqlite3 itself is synchronous. */
import { Injectable } from '@nestjs/common';
import Database from 'better-sqlite3';
import { MemoryDatabaseService } from './memory-database.service';
import {
  SourceRecord,
  SourceReliabilityRepository,
} from './source-reliability.repository';

function nowIso(): string {
  return new Date().toISOString();
}

interface ReliabilityRow {
  source_key: string;
  wins: number;
  losses: number;
  updated_at: string;
}

function toRecord(row: ReliabilityRow): SourceRecord {
  return {
    sourceKey: row.source_key,
    wins: row.wins,
    losses: row.losses,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class SqliteSourceReliabilityRepository extends SourceReliabilityRepository {
  constructor(private readonly databaseService: MemoryDatabaseService) {
    super();
  }

  private get database(): Database.Database {
    return this.databaseService.connection;
  }

  async recordOutcome(sourceKey: string, won: boolean): Promise<SourceRecord> {
    this.database
      .prepare(
        `INSERT INTO source_reliability (source_key, wins, losses, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(source_key) DO UPDATE SET
           wins = wins + excluded.wins,
           losses = losses + excluded.losses,
           updated_at = excluded.updated_at`,
      )
      .run(sourceKey, won ? 1 : 0, won ? 0 : 1, nowIso());
    const row = this.database
      .prepare('SELECT * FROM source_reliability WHERE source_key = ?')
      .get(sourceKey) as ReliabilityRow | undefined;
    if (!row) throw new Error(`Source ${sourceKey} vanished after upsert`);
    return toRecord(row);
  }

  async get(sourceKey: string): Promise<SourceRecord | null> {
    const row = this.database
      .prepare('SELECT * FROM source_reliability WHERE source_key = ?')
      .get(sourceKey) as ReliabilityRow | undefined;
    return row ? toRecord(row) : null;
  }

  async ping(): Promise<void> {
    this.database.prepare('SELECT 1').get();
  }
}
