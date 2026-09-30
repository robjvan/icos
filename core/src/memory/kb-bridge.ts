/* eslint-disable @typescript-eslint/require-await --
   async is contractual (bridge implementations are remote calls). */
/**
 * KB bridge contract (M11a, reserved). The corpus lives in KEE/M21,
 * not here: M11 defines the query shape and the `retrieved-kb` band
 * slot, and consumes whatever the bridge returns — including
 * nothing. Corpus-absent is a normal state (flagged, never failed).
 */

export interface KbHit {
  id: string;
  score: number;
  snippet?: string;
}

export abstract class KbBridge {
  /** Stable bridge identity for traces (`none` until M21). */
  abstract name(): string;

  /** False until a corpus stands behind the bridge. */
  abstract available(): Promise<boolean>;

  abstract search(text: string, k: number): Promise<KbHit[]>;
}

/**
 * Null bridge: corpus absent. Returns nothing, reports absent —
 * the M11f KB-absence invariant pins this behavior, not silence.
 */
export class NullKbBridge extends KbBridge {
  name(): string {
    return 'none';
  }

  async available(): Promise<boolean> {
    return false;
  }

  async search(): Promise<KbHit[]> {
    return [];
  }
}
