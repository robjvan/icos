/** A job's optional outbound delivery (reuses the channel-send port). */
export interface CronDelivery {
  channel: 'discord' | 'email';
  target: 'operator' | 'channel' | 'user';
  id?: string;
}

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  sessionId: string | null;
  deliver: CronDelivery | null;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewCronJob {
  name: string;
  schedule: string;
  prompt: string;
  sessionId?: string;
  deliver?: CronDelivery;
  nextRunAt: string;
}

/**
 * M17d cron-job boundary. Durable rows in the sessions DB; the scheduler
 * reads due jobs and records runs. Mirrors the other repositories'
 * abstract + SQLite split.
 */
export abstract class CronJobRepository {
  abstract create(input: NewCronJob): Promise<CronJob>;
  abstract list(): Promise<CronJob[]>;
  abstract get(id: string): Promise<CronJob | null>;
  abstract setEnabled(
    id: string,
    enabled: boolean,
    nextRunAt: string | null,
  ): Promise<CronJob | null>;
  abstract remove(id: string): Promise<boolean>;
  abstract recordRun(
    id: string,
    lastRunAt: string,
    nextRunAt: string | null,
  ): Promise<void>;
  /** Enabled jobs whose `next_run_at` is due at or before `nowIso`. */
  abstract due(nowIso: string): Promise<CronJob[]>;
  /** Cheap liveness probe for health checks. */
  abstract ping(): Promise<void>;
}
