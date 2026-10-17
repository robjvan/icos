import { Injectable, inject } from '@angular/core';
import { PROVIDERS_ENDPOINT } from '../../constants';
import { CoreApiService } from './core-api.service';

export interface ProviderStatus {
  id: string;
  model: string;
  baseUrl: string;
  enabled: boolean;
  contextWindow?: number;
  hasKey: boolean;
}

export interface ProviderReport {
  source: 'catalog' | 'env';
  active: { conversation: string; memory: string };
  activeModel: Partial<Record<ProviderRole, string>>;
  providers: ProviderStatus[];
  errors: string[];
  path: string;
}

/** One model a provider advertises (FG9c). */
export interface ProviderModel {
  id: string;
  contextWindow?: number;
}

export interface ModelList {
  ok: boolean;
  detail: string;
  models: ProviderModel[];
}

export interface ProviderEntry {
  id: string;
  baseUrl: string;
  model: string;
  apiKeyRef?: string;
  headers?: Record<string, string>;
  userAgent?: string;
  timeoutMs?: number;
  contextWindow?: number;
  enabled?: boolean;
}

export interface ProviderInput {
  baseUrl: string;
  model: string;
  apiKeyRef?: string;
  headers?: Record<string, string>;
  userAgent?: string;
  timeoutMs?: number;
  contextWindow?: number;
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

  setActive(role: ProviderRole, id: string, model?: string): Promise<ProviderReport> {
    return this.api.post<ProviderReport>(`${PROVIDERS_ENDPOINT}/active`, {
      role,
      id,
      ...(model ? { model } : {}),
    });
  }

  /** List a configured provider's models (FG9c). */
  models(id: string): Promise<ModelList> {
    return this.api.get<ModelList>(
      `${PROVIDERS_ENDPOINT}/${encodeURIComponent(id)}/models`,
    );
  }

  /** List models for an ad-hoc endpoint, before a provider is saved (FG9c). */
  probeModels(baseUrl: string, apiKeyRef?: string): Promise<ModelList> {
    return this.api.post<ModelList>(`${PROVIDERS_ENDPOINT}/models`, {
      baseUrl,
      ...(apiKeyRef ? { apiKeyRef } : {}),
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
