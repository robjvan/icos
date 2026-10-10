import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { map } from 'rxjs';
import { LucideSearch } from '@lucide/angular';
import { MemoryCandidateService } from '../../services/memory-candidate.service';
import { MemoryReviewService } from '../../services/memory-review.service';
import type { CandidateSort } from '../../models/memory-candidate';
import { ClaimList } from '../claim-list/claim-list';
import { MemoryReviewQueue } from '../memory-review-queue/memory-review-queue';

export type MemoryView = 'review' | 'beliefs' | 'ledger';

const VIEWS: readonly MemoryView[] = ['review', 'beliefs', 'ledger'];

function parseView(raw: string | null): MemoryView | null {
  return raw === 'review' || raw === 'beliefs' || raw === 'ledger' ? raw : null;
}

/**
 * Memory tab: three segments over one dataset. Review (actionable
 * queue, the fix for "easy to miss"), Beliefs (read-only claim
 * inspection), Ledger (the existing candidate list, unchanged).
 * The segment is a route query param (`/memory?view=`) so the nav
 * badge can deep-link to Review. Default: review when pending > 0,
 * else beliefs.
 */
@Component({
  selector: 'app-memory-tab',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    LucideSearch,
    ClaimList,
    MemoryReviewQueue,
  ],
  templateUrl: './memory-tab.html',
  styleUrl: './memory-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemoryTab implements OnInit {
  readonly ledger = inject(MemoryCandidateService);
  readonly review = inject(MemoryReviewService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly viewParam = toSignal(
    this.route.queryParamMap.pipe(map((params) => parseView(params.get('view')))),
    { initialValue: null },
  );

  readonly view = computed<MemoryView>(() => {
    const param = this.viewParam();
    if (param !== null) {
      return param;
    }
    return this.review.pendingCount() > 0 ? 'review' : 'beliefs';
  });

  readonly views: readonly MemoryView[] = VIEWS;

  readonly filterForm = new FormGroup({
    sessionId: new FormControl('', { nonNullable: true }),
    sort: new FormControl<CandidateSort>('recent', { nonNullable: true }),
  });

  ngOnInit(): void {
    void this.ledger.refresh();
    void this.review.refresh();
  }

  selectView(view: MemoryView): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { view },
      queryParamsHandling: 'merge',
    });
  }

  refresh(): void {
    const sessionId = this.filterForm.controls.sessionId.value.trim();
    this.ledger.sort.set(this.filterForm.controls.sort.value);
    void this.ledger.refresh(sessionId || undefined);
  }

  clearFilter(): void {
    this.filterForm.controls.sessionId.setValue('');
    this.filterForm.controls.sort.setValue('recent');
    this.ledger.sort.set('recent');
    void this.ledger.refresh();
  }
}
