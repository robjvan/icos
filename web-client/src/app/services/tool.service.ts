import { Injectable, inject } from '@angular/core';
import { TOOLS_ENDPOINT } from '../../constants';
import type { ToolDiscoveryState, ToolInventoryResponse } from '../models/tool';
import { CoreApiService } from './core-api.service';

/** Tool inventory + global auto-approve overrides (M20f). */
@Injectable({ providedIn: 'root' })
export class ToolService {
  private readonly api = inject(CoreApiService);

  async inventory(): Promise<ToolInventoryResponse> {
    return this.api.get<ToolInventoryResponse>(`${TOOLS_ENDPOINT}/inventory`);
  }

  /** M20.7 discovery state + bounds (read-only). */
  async discovery(): Promise<ToolDiscoveryState> {
    return this.api.get<ToolDiscoveryState>(`${TOOLS_ENDPOINT}/discovery`);
  }

  async setAutoApprove(name: string, autoApprove: boolean): Promise<ToolInventoryResponse> {
    return this.api.put<ToolInventoryResponse>(
      `${TOOLS_ENDPOINT}/auto-approve/${encodeURIComponent(name)}`,
      { autoApprove },
    );
  }
}
