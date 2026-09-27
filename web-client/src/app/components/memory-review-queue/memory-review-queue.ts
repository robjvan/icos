import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import type { MemoryCandidate } from '../../models/memory-candidate';
import { MemoryCandidateService } from '../../services/memory-candidate.service';
import { MemoryReviewService } from '../../services/memory-review.service';
import {
  contradictsClaimId,
  reviewState,
  willContradict,
  type PromotionQueueItem,
} from '../../models/promotion';
import { StatusBadge } from '../status-badge/status-badge';

/**
 * Review lens (Axis A): the global actionable queue. Approve means
 * approve *and* execute via the service; rows whose statement join
 * misses the ledger disable approve (core would fail them with
 * `missing_candidate` anyway, so offering the button would lie).
 * Focus returns to the triggering row's region after approve/reject.
 */
@Component({
  selector: 'app-memory-review-queue',
  imports: [StatusBadge],
  templateUrl: './memory-review-queue.html',
  styleUrl: './memory-review-queue.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemoryReviewQueue implements OnInit {
  readonly review = inject(MemoryReviewService);
  readonly ledger = inject(MemoryCandidateService);

  private readonly queueRegion = viewChild<ElementRef<HTMLElement>>('queueRegion');

  readonly candidateById = signal<ReadonlyMap<string, MemoryCandidate>>(new Map());
  readonly pendingFocusId = signal<string | null>(null);

  readonly openCount = computed(() => this.review.pendingCount());
  readonly truncated = computed(() => this.review.total() > this.review.items().length);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    await this.review.refresh();
    await this.ledger.refresh();
    this.rebuildCandidateMap();
  }

  toggleResolved(show: boolean): void {
    this.review.setShowResolved(show);
  }

  stateOf(item: PromotionQueueItem): ReturnType<typeof reviewState> {
    return reviewState(item);
  }

  stateLabel(item: PromotionQueueItem): string {
    switch (reviewState(item)) {
      case 'PENDING':
        return 'Awaiting review';
      case 'AWAITING_SWEEP':
        return 'Approved — not yet committed';
      case 'APPROVED':
        return 'Committed';
      case 'AUTO':
        return 'Self-promoted';
      case 'REJECTED':
        return 'Rejected';
      case 'FAILED':
        return `Failed — ${item.detail || 'unknown'}`;
    }
  }

  statementFor(item: PromotionQueueItem): string {
    const candidate = this.candidateById().get(item.candidateId);
    if (!candidate) {
      return 'evidence unavailable';
    }
    return `${candidate.subject} ${candidate.predicate} ${candidate.object}`;
  }

  canApprove(item: PromotionQueueItem): boolean {
    return (
      this.stateOf(item) === 'PENDING' &&
      this.candidateById().has(item.candidateId) &&
      this.review.busyId() === null
    );
  }

  canReject(item: PromotionQueueItem): boolean {
    return this.stateOf(item) === 'PENDING' && this.review.busyId() === null;
  }

  contradicts(item: PromotionQueueItem): boolean {
    return willContradict(item);
  }

  contradictsId(item: PromotionQueueItem): string | null {
    return contradictsClaimId(item);
  }

  approve(item: PromotionQueueItem): void {
    this.pendingFocusId.set(item.id);
    void this.review.approve(item.id).finally(() => this.restoreFocus());
  }

  reject(item: PromotionQueueItem): void {
    this.pendingFocusId.set(item.id);
    void this.review.reject(item.id).finally(() => this.restoreFocus());
  }

  runSweep(): void {
    void this.review.runPromotions();
  }

  private rebuildCandidateMap(): void {
    const map = new Map<string, MemoryCandidate>();
    for (const candidate of this.ledger.candidates()) {
      map.set(candidate.id, candidate);
    }
    this.candidateById.set(map);
  }

  private restoreFocus(): void {
    this.rebuildCandidateMap();
    const id = this.pendingFocusId();
    this.pendingFocusId.set(null);
    if (!id) {
      return;
    }
    const region = this.queueRegion()?.nativeElement;
    const target = region?.querySelector<HTMLElement>(`[data-row="${id}"] button`);
    (target ?? region)?.focus({ preventScroll: true });
  }
}
