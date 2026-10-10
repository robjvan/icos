/** A job's optional outbound delivery. Mirrors core `CronDelivery`. */
export interface CronDelivery {
  readonly channel: 'discord' | 'email';
  readonly target: 'operator' | 'channel' | 'user';
  readonly id?: string;
}

/** Mirrors core `CronJob`. */
export interface CronJob {
  readonly id: string;
  readonly name: string;
  readonly schedule: string;
  readonly prompt: string;
  readonly sessionId: string | null;
  readonly deliver: CronDelivery | null;
  readonly enabled: boolean;
  readonly lastRunAt: string | null;
  readonly nextRunAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CronListResponse {
  readonly jobs: CronJob[];
}

export interface CronJobResponse {
  readonly job: CronJob;
}

export interface CronRunResponse {
  readonly reply: string | null;
  readonly delivered: boolean;
}
