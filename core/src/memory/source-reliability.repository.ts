/**
 * Per-source track record (M12c). A source is an evidence origin
 * (`role/model`, e.g. `assistant/gemma4-e4b-mem:latest`): revision
 * outcomes accrue here, and the Laplace-smoothed influence factor
 * (`reliabilityFactor`) damps repeatedly-losing sources in ranking.
 * No row means neutral — silence, not suspicion.
 */
export interface SourceRecord {
  sourceKey: string;
  wins: number;
  losses: number;
  updatedAt: string;
}

export abstract class SourceReliabilityRepository {
  abstract recordOutcome(
    sourceKey: string,
    won: boolean,
  ): Promise<SourceRecord>;

  abstract get(sourceKey: string): Promise<SourceRecord | null>;

  /** Cheap liveness probe for health checks. */
  abstract ping(): Promise<void>;
}
