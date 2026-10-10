import { Injectable, inject } from '@angular/core';
import { CONTEXT_ENDPOINT } from '../../constants';
import type {
  ContextSettings,
  ContextSettingsResponse,
  ContextSummaryResponse,
} from '../models/context';
import { CoreApiService } from './core-api.service';

/**
 * Context budget + compaction surface (M20.6.3). Read is open; changing the
 * target/enabled is admin-only server-side (a 403 surfaces as an error).
 */
@Injectable({ providedIn: 'root' })
export class ContextService {
  private readonly api = inject(CoreApiService);

  async settings(): Promise<ContextSettings> {
    const data = await this.api.get<ContextSettingsResponse>(CONTEXT_ENDPOINT);
    return data.settings;
  }

  async summary(sessionId: string): Promise<ContextSummaryResponse> {
    return this.api.get<ContextSummaryResponse>(`${CONTEXT_ENDPOINT}/summary`, {
      sessionId,
    });
  }

  async update(patch: {
    target?: number;
    enabled?: boolean;
  }): Promise<ContextSettings> {
    const data = await this.api.put<ContextSettingsResponse>(
      CONTEXT_ENDPOINT,
      patch,
    );
    return data.settings;
  }
}
