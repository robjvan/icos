import { Injectable } from '@nestjs/common';
import type { ClaimOrigin } from './claim';
import type { ComparisonNote, ProposedQuestion } from './comparison';

/** Persisted per-turn recall record: what was asked, found, and shown. */
export interface RecallTrace {
  sessionId: string;
  at: string;
  query: { text: string; tokens: string[] };
  surfaces: Record<
    string,
    { available: boolean; hits: number; reason?: string }
  >;
  ranked: {
    claimId: string;
    disposition: string;
    demoted: boolean;
    fusedScore: number;
    surfaces: string[];
    reasons: string[];
  }[];
  notes: ComparisonNote[];
  proposedQuestions: ProposedQuestion[];
  lens: { exclude: ClaimOrigin[] };
  gate: number;
  bands: { memory: boolean; kb: boolean };
  /** False until a corpus stands behind the KB bridge (M21). */
  kbAvailable: boolean;
  degraded: string[];
}

/** Bounded in-memory trace log (inspection only — never beliefs). */
const MAX_TRACES = 100;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Last-recall trace per session for `GET /core/recall/trace`.
 * Ephemeral debug surface: bounded, process-local, lost on restart
 * by design (traces explain turns; the ledger + journal are the
 * durable record). Ranked rows are stored whole — small, and the
 * trace must read without a database round-trip.
 */
@Injectable()
export class RecallTraceStore {
  private readonly traces = new Map<string, RecallTrace>();

  save(trace: Omit<RecallTrace, 'at'>): RecallTrace {
    const stored: RecallTrace = { ...trace, at: nowIso() };
    this.traces.set(trace.sessionId, stored);
    while (this.traces.size > MAX_TRACES) {
      const oldest = this.traces.keys().next();
      if (oldest.done) break;
      this.traces.delete(oldest.value);
    }
    return stored;
  }

  get(sessionId: string): RecallTrace | null {
    return this.traces.get(sessionId) ?? null;
  }
}
