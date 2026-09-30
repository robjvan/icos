import { Injectable, inject, signal } from '@angular/core';
import { APPROVALS_ENDPOINT, PROMOTIONS_ENDPOINT } from '../../constants';
import type {
  ListPromotionsResponse,
  PromotionQueueItem,
  RunPromotionsResponse,
  SweepSummary,
} from '../models/promotion';
import type { Approval } from '../models/approval';
import { CoreApiService } from './core-api.service';

const REVIEW_QUEUE_LIMIT = 200;

const OPEN_STATES = 'proposed,promoting';
const RESOLVED_STATES = 'proposed,promoting,committed,denied,failed';

/**
 * Global promotion-review queue. Owns the pending-review count signal
 * so the nav badge can render it, and the approve/reject/run paths so
 * resolution never goes through `ConversationStore` (memory promotions
 * park no turn — routing through the parked-turn resume would be
 * semantically wrong).
 *
 * Approve means approve *and* execute: after a successful approval the
 * service runs the global sweep, then re-fetches. Approving without
 * running would park the row in an easily-mistaken state (authority
 * recorded, belief not yet committed).
 *
 * Realtime seam: `realtime-transport.md` will call `refresh()` on
 * `promotion.*` and `approval.*` events. Until then this phase polls
 * on open, on action, and on manual refresh.
 */
@Injectable({ providedIn: 'root' })
export class MemoryReviewService {
  private readonly api = inject(CoreApiService);

  readonly items = signal<readonly PromotionQueueItem[]>([]);
  readonly total = signal(0);
  readonly showResolved = signal(false);
  readonly busyId = signal<string | null>(null);
  readonly runningSweep = signal(false);
  readonly error = signal<string | null>(null);
  readonly lastSummary = signal<SweepSummary | null>(null);

  /** Open (actionable) rows only — drives the nav badge. */
  readonly pendingCount = (): number =>
    this.items().filter((item) => item.state === 'proposed' || item.state === 'promoting')
      .length;

  async refresh(): Promise<void> {
    this.error.set(null);
    try {
      const data = await this.api.get<ListPromotionsResponse>(PROMOTIONS_ENDPOINT, {
        state: this.showResolved() ? RESOLVED_STATES : OPEN_STATES,
        limit: REVIEW_QUEUE_LIMIT,
      });
      this.items.set(data.promotions);
      this.total.set(data.total);
    } catch (error) {
      this.items.set([]);
      this.total.set(0);
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  setShowResolved(show: boolean): void {
    if (this.showResolved() === show) {
      return;
    }
    this.showResolved.set(show);
    void this.refresh();
  }

  /**
   * Approve a review item, run the sweep, re-fetch. The owning session
   * is resolved lazily per item (the queue is global); only approve is
   * exposed since the sweep executes — reject/cancel use their own path.
   */
  async approve(id: string): Promise<void> {
    const item = this.items().find((row) => row.id === id);
    if (!item?.approvalId || this.busyId() !== null) {
      return;
    }
    this.busyId.set(id);
    this.error.set(null);
    try {
      const approval = await this.api.get<Approval>(
        `${APPROVALS_ENDPOINT}/${item.approvalId}`,
      );
      await this.api.post(`${APPROVALS_ENDPOINT}/${item.approvalId}/approve`, {
        sessionId: approval.sessionId,
      });
      await this.runSweep();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.busyId.set(null);
    }
    await this.refresh();
  }

  /** Reject a review item (terminal, never retried), then re-fetch. */
  async reject(id: string): Promise<void> {
    const item = this.items().find((row) => row.id === id);
    if (!item?.approvalId || this.busyId() !== null) {
      return;
    }
    this.busyId.set(id);
    this.error.set(null);
    try {
      const approval = await this.api.get<Approval>(
        `${APPROVALS_ENDPOINT}/${item.approvalId}`,
      );
      await this.api.post(`${APPROVALS_ENDPOINT}/${item.approvalId}/reject`, {
        sessionId: approval.sessionId,
      });
    } catch (error) {
      // Resolution race: already resolved elsewhere (409) means the
      // true state is one refresh away, not an actionable error.
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('409')) {
        this.error.set(message);
      }
    } finally {
      this.busyId.set(null);
    }
    await this.refresh();
  }

  /**
   * Explicit sweep driver. Always renders the returned summary counts,
   * including denied/failed — a silent partial sweep is exactly the
   * failure mode the Review lens exists to prevent.
   */
  async runPromotions(): Promise<void> {
    if (this.runningSweep()) {
      return;
    }
    this.runningSweep.set(true);
    this.error.set(null);
    try {
      await this.runSweep();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.runningSweep.set(false);
    }
    await this.refresh();
  }

  private async runSweep(): Promise<void> {
    const data = await this.api.post<RunPromotionsResponse>(
      `${PROMOTIONS_ENDPOINT}/run`,
      {},
    );
    this.lastSummary.set(data.summary);
  }
}
