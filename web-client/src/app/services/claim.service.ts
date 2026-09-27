import { Injectable, inject } from '@angular/core';
import { CLAIMS_ENDPOINT } from '../../constants';
import type {
  ClaimDetailResponse,
  ClaimFilters,
  ListClaimsResponse,
  SearchClaimsResponse,
} from '../models/claim';
import { CoreApiService } from './core-api.service';

const CLAIM_LIST_LIMIT = 200;

/**
 * Read-only belief inspection over `GET /core/claims*`. Claims are born
 * through promotion and age through dynamics — nothing here mutates.
 * Surfaces `degraded` honestly (badge + reason), never silently showing
 * partial results as complete.
 */
@Injectable({ providedIn: 'root' })
export class ClaimService {
  private readonly api = inject(CoreApiService);

  async list(filters: ClaimFilters = {}): Promise<ListClaimsResponse> {
    return this.api.get<ListClaimsResponse>(CLAIMS_ENDPOINT, {
      ...(filters.status !== undefined ? { status: filters.status } : {}),
      ...(filters.category !== undefined ? { category: filters.category } : {}),
      ...(filters.origin !== undefined ? { origin: filters.origin } : {}),
      limit: filters.limit ?? CLAIM_LIST_LIMIT,
    });
  }

  async search(query: string, k = 5): Promise<SearchClaimsResponse> {
    return this.api.get<SearchClaimsResponse>(`${CLAIMS_ENDPOINT}/search`, {
      q: query,
      k,
    });
  }

  async detail(id: string): Promise<ClaimDetailResponse> {
    return this.api.get<ClaimDetailResponse>(
      `${CLAIMS_ENDPOINT}/${encodeURIComponent(id)}`,
    );
  }
}
