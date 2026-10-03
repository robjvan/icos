import type {
  HallucinationSeverity,
  MitigationStrategy,
} from './hallucination-modes';

/** One recorded mitigation decision (append-only, M15.5d). */
export interface HallucinationMitigationEntry {
  id: string;
  severity: HallucinationSeverity;
  strategy: MitigationStrategy;
  /** The failure mode that triggered it, when there was one. */
  mode: string | null;
  reason: string;
  subject: string | null;
  detail?: Record<string, unknown>;
  createdAt: string;
}

export interface RecordMitigationInput {
  severity: HallucinationSeverity;
  strategy: MitigationStrategy;
  mode?: string | null;
  reason: string;
  subject?: string | null;
  detail?: Record<string, unknown>;
  occurredAt?: string;
}

/**
 * Append-only audit of what ICOS did with a finding. Mitigation is never
 * silent: the ledger records the strategy and the finding that drove it.
 */
export abstract class HallucinationLedgerRepository {
  abstract record(
    input: RecordMitigationInput,
  ): Promise<HallucinationMitigationEntry>;

  abstract list(limit?: number): Promise<HallucinationMitigationEntry[]>;

  /** Cheap liveness probe for health checks. */
  abstract ping(): Promise<void>;
}
