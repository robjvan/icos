import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { LucideSearch } from '@lucide/angular';
import type { Claim, ClaimCategory, ClaimOrigin, ClaimStatus } from '../../models/claim';
import type { MemoryCandidate } from '../../models/memory-candidate';
import { ClaimService } from '../../services/claim.service';
import { StatusBadge } from '../status-badge/status-badge';

/**
 * Beliefs lens (Axis B): read-only browse over the claim store.
 * Filters are status/category/origin/limit — never kind. Search
 * `degraded` renders honestly (badge + reason), never silently
 * partial. Detail shows evidence roles, the provenance pair
 * (firstAssertedAt vs lastSurfacedAt are candidate ids), and the two
 * confidence fields as distinct values.
 *
 * Live updates: `ClaimService.revision` bumps on every pushed
 * claim/promotion event; an effect reloads the list (guarded past the
 * initial revision so `ngOnInit` stays the single hydration path).
 */
@Component({
  selector: 'app-claim-list',
  imports: [ReactiveFormsModule, LucideSearch, StatusBadge],
  templateUrl: './claim-list.html',
  styleUrl: './claim-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClaimList implements OnInit {
  private readonly claimsApi = inject(ClaimService);

  constructor() {
    // Live Beliefs: reload on pushed claim/promotion events. The initial
    // revision (0) is skipped — ngOnInit owns hydration — so this never
    // double-fetches on open.
    effect(() => {
      const revision = this.claimsApi.revision();
      if (revision === 0) return;
      untracked(() => void this.load());
    });
  }

  readonly claims = signal<readonly Claim[]>([]);
  readonly error = signal<string | null>(null);
  readonly degraded = signal<string | null>(null);
  readonly results = signal<readonly (Claim & { readonly score: number })[]>([]);
  readonly selected = signal<Claim | null>(null);
  readonly selectedEvidence = signal<readonly (MemoryCandidate | null)[]>([]);
  readonly selectedHistory = signal<readonly { readonly operation: string; readonly state: string }[]>([]);

  readonly hasResults = computed(() => this.results().length > 0);

  readonly filterForm = new FormGroup({
    status: new FormControl<'' | ClaimStatus>('', { nonNullable: true }),
    category: new FormControl<'' | ClaimCategory>('', { nonNullable: true }),
    origin: new FormControl<'' | ClaimOrigin>('', { nonNullable: true }),
  });

  readonly searchForm = new FormGroup({
    query: new FormControl('', { nonNullable: true }),
  });

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    try {
      const filters = this.filterForm.value;
      const data = await this.claimsApi.list({
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.category ? { category: filters.category } : {}),
        ...(filters.origin ? { origin: filters.origin } : {}),
      });
      this.claims.set(data.claims);
    } catch (error) {
      this.claims.set([]);
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  clearFilters(): void {
    this.filterForm.reset({ status: '', category: '', origin: '' });
    void this.load();
  }

  async search(): Promise<void> {
    const query = this.searchForm.controls.query.value.trim();
    if (!query) {
      return;
    }
    this.error.set(null);
    this.degraded.set(null);
    try {
      const data = await this.claimsApi.search(query);
      this.results.set(data.results);
      if (data.degraded) {
        this.degraded.set(data.reason ?? 'claim index unavailable');
      }
    } catch (error) {
      this.results.set([]);
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  async openClaim(id: string): Promise<void> {
    this.error.set(null);
    try {
      const data = await this.claimsApi.detail(id);
      this.selected.set(data.claim);
      this.selectedEvidence.set(data.evidence);
      this.selectedHistory.set(data.history);
    } catch (error) {
      this.selected.set(null);
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  closeClaim(): void {
    this.selected.set(null);
  }
}
