/* eslint-disable @typescript-eslint/require-await --
   async is contractual (repository returns Promises);
   better-sqlite3 itself is synchronous. */
import { Injectable } from '@nestjs/common';
import Database from 'better-sqlite3';
import { MemoryDatabaseService } from './memory-database.service';

export interface LexicalHit {
  claimId: string;
  /** BM25 rank (lower is closer — FTS5 convention, kept raw). */
  score: number;
}

interface FtsRow {
  rowid: number;
  rank: number;
}

const MAX_LEXICAL_LIMIT = 50;

/**
 * Lexical recall surface (M11a): FTS5 over immutable claim text.
 * Query safety first (v2's hyphen lesson): input is reduced to
 * alphanumeric tokens before touching FTS5 syntax, so natural
 * language — quotes, hyphens, stars, carets — can never crash or
 * reinterpret the query. Strategy: exact-phrase attempt, then
 * token-AND fallback. BM25 rank rides through untouched; M11b owns
 * cross-surface normalization.
 */
@Injectable()
export class SqliteLexicalClaimIndex {
  constructor(private readonly databaseService: MemoryDatabaseService) {}

  private get database(): Database.Database {
    return this.databaseService.connection;
  }

  /** Alphanumeric tokens safe for FTS5 syntax positions. */
  private static queryTokens(text: string): string[] {
    const tokens = text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 0);
    return [...new Set(tokens)];
  }

  async searchLexical(text: string, k: number): Promise<LexicalHit[]> {
    const limit = Math.min(Math.max(k, 1), MAX_LEXICAL_LIMIT);
    const tokens = SqliteLexicalClaimIndex.queryTokens(text);
    if (tokens.length === 0) return [];
    // Exact phrase first ("user prefers"), token-AND fallback.
    const phrase = await this.searchFts(`"${tokens.join(' ')}"`, limit);
    if (phrase.length > 0) return phrase;
    return this.searchFts(tokens.join(' '), limit);
  }

  private async searchFts(match: string, limit: number): Promise<LexicalHit[]> {
    const rows = this.database
      .prepare(
        `SELECT rowid, bm25(claims_fts) AS rank
           FROM claims_fts
          WHERE claims_fts MATCH ?
          ORDER BY rank
          LIMIT ?`,
      )
      .all(match, limit) as FtsRow[];
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.rowid);
    const placeholders = ids.map(() => '?').join(', ');
    // Row order is not guaranteed; rejoin explicitly below.
    const ordered = this.database
      .prepare(`SELECT rowid, id FROM claims WHERE rowid IN (${placeholders})`)
      .all(...ids) as { rowid: number; id: string }[];
    const byRowid = new Map<number, string>();
    for (const row of ordered) byRowid.set(row.rowid, row.id);
    return rows.flatMap((row) => {
      const claimId = byRowid.get(row.rowid);
      return claimId ? [{ claimId, score: row.rank }] : [];
    });
  }

  async ping(): Promise<void> {
    this.database.prepare('SELECT 1').get();
  }
}
