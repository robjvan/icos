import { Injectable, inject } from '@angular/core';
import { PROVIDERS_ENDPOINT } from '../../constants';
import { CoreApiService } from './core-api.service';

export interface ProviderStatus {
  id: string;
  model: string;
  baseUrl: string;
  enabled: boolean;
  hasKey: boolean;
}

export interface ProviderReport {
  source: 'catalog' | 'env';
  active: { conversation: string; memory: string };
  providers: ProviderStatus[];
  errors: string[];
  path: string;
}

export interface ProviderEntry {
  id: string;
  baseUrl: string;
  model: string;
  apiKeyRef?: string;
  headers?: Record<string, string>;
  userAgent?: string;
  timeoutMs?: number;
  enabled?: boolean;
}

export interface ProviderInput {
  baseUrl: string;
  model: string;
  apiKeyRef?: string;
  headers?: Record<string, string>;
  userAgent?: string;
  timeoutMs?: number;
  enabled?: boolean;
}

export type ProviderRole = 'conversation' | 'memory';

/** LLM provider management (S5). Never receives a stored key back. */
@Injectable({ providedIn: 'root' })
export class ProviderAdminService {
  private readonly api = inject(CoreApiService);

  report(): Promise<ProviderReport> {
    return this.api.get<ProviderReport>(PROVIDERS_ENDPOINT);
  }

  async catalog(): Promise<ProviderEntry[]> {
    const body = await this.api.get<{ providers: ProviderEntry[] }>(
      `${PROVIDERS_ENDPOINT}/catalog`,
    );
    return body.providers;
  }

  upsert(id: string, input: ProviderInput): Promise<ProviderReport> {
    return this.api.put<ProviderReport>(
      `${PROVIDERS_ENDPOINT}/${encodeURIComponent(id)}`,
      input,
    );
  }

  remove(id: string): Promise<ProviderReport> {
    return this.api.delete<ProviderReport>(
      `${PROVIDERS_ENDPOINT}/${encodeURIComponent(id)}`,
    );
  }

  setActive(role: ProviderRole, id: string): Promise<ProviderReport> {
    return this.api.post<ProviderReport>(`${PROVIDERS_ENDPOINT}/active`, {
      role,
      id,
    });
  }

  test(id: string): Promise<{ ok: boolean; detail: string }> {
    return this.api.post<{ ok: boolean; detail: string }>(
      `${PROVIDERS_ENDPOINT}/${encodeURIComponent(id)}/test`,
      {},
    );
  }

  reload(): Promise<ProviderReport> {
    return this.api.post<ProviderReport>(`${PROVIDERS_ENDPOINT}/reload`, {});
  }
}
