import { Injectable } from '@nestjs/common';

/**
 * Per-session staged tool pulls (M20.7.2). Two slots:
 * - `pending` — operator `/tools pull`, waiting for the next turn;
 * - `active` — this turn's staged names (operator pulls promoted at the turn
 *   start, plus anything the `search_platform_tools` meta-tool stages).
 *
 * Strictly per-turn: a fresh turn promotes `pending` into `active` and drops
 * the previous turn's `active`, so discovered schemas are never retained
 * indefinitely. Bounded by construction (the injected set is capped upstream).
 *
 * Staging is *discoverability*, not authorization: a staged name must still be
 * in the operator policy to be injected, and its call still validates +
 * approves normally.
 */
@Injectable()
export class ToolPullStore {
  private readonly pending = new Map<string, Set<string>>();
  private readonly active = new Map<string, Set<string>>();
  private readonly attempts = new Map<string, number>();

  /** Operator pull: waits for the next turn. */
  stagePending(sessionId: string, names: readonly string[]): void {
    this.addTo(this.pending, sessionId, names);
  }

  /** Meta-tool pull: active for this turn (and its later rounds). */
  stage(sessionId: string, names: readonly string[]): void {
    this.addTo(this.active, sessionId, names);
  }

  /** Staged names for the current turn (does not consume). */
  peek(sessionId: string): string[] {
    return [...(this.active.get(sessionId) ?? [])];
  }

  /**
   * Begin a fresh turn: promote operator pulls into the active slot and reset
   * the meta-tool attempt count. The previous turn's active set is dropped.
   */
  beginTurn(sessionId: string): void {
    const pending = this.pending.get(sessionId);
    this.pending.delete(sessionId);
    this.active.set(sessionId, new Set(pending ?? []));
    this.attempts.delete(sessionId);
  }

  /** Meta-tool pull attempts recorded this turn. */
  attemptsUsed(sessionId: string): number {
    return this.attempts.get(sessionId) ?? 0;
  }

  /** Record a meta-tool pull attempt (for the per-turn bound). */
  recordAttempt(sessionId: string): void {
    this.attempts.set(sessionId, this.attemptsUsed(sessionId) + 1);
  }

  /** Clear a session's staged names + attempt count. */
  clear(sessionId: string): void {
    this.pending.delete(sessionId);
    this.active.delete(sessionId);
    this.attempts.delete(sessionId);
  }

  private addTo(
    slot: Map<string, Set<string>>,
    sessionId: string,
    names: readonly string[],
  ): void {
    const set = slot.get(sessionId) ?? new Set<string>();
    for (const name of names) set.add(name);
    slot.set(sessionId, set);
  }
}
