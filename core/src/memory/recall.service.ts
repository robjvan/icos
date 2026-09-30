import { Injectable, Logger } from '@nestjs/common';
import { AssociativeRecall } from './associative-recall';
import { ClaimIndex, ClaimIndexUnavailableError } from './claim-index';
import { KbBridge } from './kb-bridge';
import type { KbHit } from './kb-bridge';
import { shapeQuery } from './query-shaping';
import type { ShapedQuery } from './query-shaping';
import { SqliteLexicalClaimIndex } from './sqlite-lexical-claim-index';

export type RecallSurfaceName = 'lexical' | 'semantic' | 'associative';

export interface RecallHit {
  claimId: string;
  /** Raw surface score (conventions differ per surface — M11b normalizes). */
  score: number;
  surface: RecallSurfaceName;
}

export interface SurfaceResult {
  surface: RecallSurfaceName;
  /** False = surface down or empty query; hits empty; reason set. */
  available: boolean;
  reason?: string;
  hits: RecallHit[];
}

export interface RecallResult {
  query: ShapedQuery;
  lexical: SurfaceResult;
  semantic: SurfaceResult;
  associative: SurfaceResult;
  kb: { available: boolean; hits: KbHit[] };
}

/**
 * Parallel recall fan-out (M11a): lexical + semantic + associative
 * over one shaped query, KB bridge alongside. One failing surface
 * never blocks the others — each is independently try/caught and
 * reports `available: false` with its reason (v2's surface trace
 * starts here; M11b fuses, M11d renders). No turn wiring, no
 * ranking, no mutation: this service only asks, never keeps.
 */
@Injectable()
export class RecallService {
  private readonly logger = new Logger(RecallService.name);

  constructor(
    private readonly lexical: SqliteLexicalClaimIndex,
    private readonly semantic: ClaimIndex,
    private readonly associative: AssociativeRecall,
    private readonly kb: KbBridge,
  ) {}

  async recall(text: string, k: number): Promise<RecallResult> {
    const query = shapeQuery(text);
    const [lexical, semantic, associative, kb] = await Promise.all([
      this.runLexical(query.text, k),
      this.runSemantic(query.text, k),
      this.runAssociative(query.tokens, k),
      this.runKb(query.text, k),
    ]);
    return { query, lexical, semantic, associative, kb };
  }

  private async runLexical(text: string, k: number): Promise<SurfaceResult> {
    const base = { surface: 'lexical' as const, hits: [] };
    if (text === '')
      return { ...base, available: false, reason: 'empty_query' };
    try {
      const hits = await this.lexical.searchLexical(text, k);
      return {
        ...base,
        available: true,
        hits: hits.map((hit) => ({ ...hit, surface: 'lexical' as const })),
      };
    } catch (err) {
      return { ...base, available: false, reason: this.describe(err) };
    }
  }

  private async runSemantic(text: string, k: number): Promise<SurfaceResult> {
    const base = { surface: 'semantic' as const, hits: [] };
    if (text === '')
      return { ...base, available: false, reason: 'empty_query' };
    try {
      const hits = await this.semantic.searchSimilar(text, k);
      return {
        ...base,
        available: true,
        hits: hits.map((hit) => ({ ...hit, surface: 'semantic' as const })),
      };
    } catch (err) {
      if (err instanceof ClaimIndexUnavailableError) {
        return { ...base, available: false, reason: 'index_unavailable' };
      }
      return { ...base, available: false, reason: this.describe(err) };
    }
  }

  private async runAssociative(
    tokens: string[],
    k: number,
  ): Promise<SurfaceResult> {
    const base = { surface: 'associative' as const, hits: [] };
    if (tokens.length === 0) {
      return { ...base, available: false, reason: 'empty_query' };
    }
    try {
      const hits = await this.associative.recallAssociative(tokens, k);
      return {
        ...base,
        available: true,
        hits: hits.map((hit) => ({ ...hit, surface: 'associative' as const })),
      };
    } catch (err) {
      return { ...base, available: false, reason: this.describe(err) };
    }
  }

  private async runKb(
    text: string,
    k: number,
  ): Promise<{ available: boolean; hits: KbHit[] }> {
    try {
      if (!(await this.kb.available())) return { available: false, hits: [] };
      return { available: true, hits: await this.kb.search(text, k) };
    } catch (err) {
      this.logger.warn(
        `KB bridge failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      return { available: false, hits: [] };
    }
  }

  private describe(err: unknown): string {
    const message = err instanceof Error ? err.message : 'unknown error';
    this.logger.warn(`Recall surface failed: ${message}`);
    return `error:${message}`;
  }
}
