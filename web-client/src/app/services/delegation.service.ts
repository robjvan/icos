import { Injectable, inject } from '@angular/core';
import { DELEGATIONS_ENDPOINT } from '../../constants';
import type { ListDelegationsResponse } from '../models/delegation';
import { CoreApiService } from './core-api.service';

/** Subagent delegation inspection (M21.2, read-only). */
@Injectable({ providedIn: 'root' })
export class DelegationService {
  private readonly api = inject(CoreApiService);

  async list(parentSessionId: string): Promise<ListDelegationsResponse> {
    return this.api.get<ListDelegationsResponse>(DELEGATIONS_ENDPOINT, {
      parentSessionId,
    });
  }
}
