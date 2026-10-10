import { Injectable, inject } from '@angular/core';
import { CRON_ENDPOINT } from '../../constants';
import type {
  CronJobResponse,
  CronListResponse,
  CronRunResponse,
} from '../models/cron';
import { CoreApiService } from './core-api.service';

/** Cron management (M20h): list, create, pause/resume, run-now, delete. */
@Injectable({ providedIn: 'root' })
export class CronService {
  private readonly api = inject(CoreApiService);

  async list(): Promise<CronListResponse> {
    return this.api.get<CronListResponse>(CRON_ENDPOINT);
  }

  async create(input: {
    name: string;
    schedule: string;
    prompt: string;
  }): Promise<CronJobResponse> {
    return this.api.post<CronJobResponse>(CRON_ENDPOINT, input);
  }

  async pause(id: string): Promise<CronJobResponse> {
    return this.api.post<CronJobResponse>(`${CRON_ENDPOINT}/${encodeURIComponent(id)}/pause`, {});
  }

  async resume(id: string): Promise<CronJobResponse> {
    return this.api.post<CronJobResponse>(`${CRON_ENDPOINT}/${encodeURIComponent(id)}/resume`, {});
  }

  async run(id: string): Promise<CronRunResponse> {
    return this.api.post<CronRunResponse>(`${CRON_ENDPOINT}/${encodeURIComponent(id)}/run`, {});
  }

  async remove(id: string): Promise<{ deleted: true; id: string }> {
    return this.api.delete<{ deleted: true; id: string }>(
      `${CRON_ENDPOINT}/${encodeURIComponent(id)}`,
    );
  }
}
