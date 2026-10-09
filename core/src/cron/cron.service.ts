import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CronJobRepository } from './cron-job.repository';
import type { CronDelivery, CronJob } from './cron-job.repository';
import { nextCronRun, parseCron } from './cron-expression';
import { CronScheduler } from './cron-scheduler.service';

/**
 * M17d cron-job management (the `cronjob_manage` tool). Validation and
 * next-run computation live here; the scheduler owns execution.
 */
@Injectable()
export class CronService {
  constructor(
    private readonly jobs: CronJobRepository,
    private readonly scheduler: CronScheduler,
  ) {}

  async create(input: {
    name: string;
    schedule: string;
    prompt: string;
    sessionId?: string;
    deliver?: CronDelivery;
  }): Promise<CronJob> {
    if (!parseCron(input.schedule)) {
      throw new BadRequestException(
        'invalid cron schedule (minute hour dom month dow)',
      );
    }
    const next = nextCronRun(input.schedule, new Date());
    return this.jobs.create({
      ...input,
      nextRunAt: (next ?? new Date()).toISOString(),
    });
  }

  list(): Promise<CronJob[]> {
    return this.jobs.list();
  }

  async pause(id: string): Promise<CronJob> {
    const job = await this.jobs.setEnabled(id, false, null);
    if (!job) throw new NotFoundException(`Unknown cron job "${id}"`);
    return job;
  }

  async resume(id: string): Promise<CronJob> {
    const job = await this.jobs.get(id);
    if (!job) throw new NotFoundException(`Unknown cron job "${id}"`);
    const next = nextCronRun(job.schedule, new Date());
    const resumed = await this.jobs.setEnabled(
      id,
      true,
      next ? next.toISOString() : null,
    );
    if (!resumed) throw new NotFoundException(`Unknown cron job "${id}"`);
    return resumed;
  }

  async remove(id: string): Promise<void> {
    const removed = await this.jobs.remove(id);
    if (!removed) throw new NotFoundException(`Unknown cron job "${id}"`);
  }

  async runNow(
    id: string,
  ): Promise<{ reply: string | null; delivered: boolean }> {
    const job = await this.jobs.get(id);
    if (!job) throw new NotFoundException(`Unknown cron job "${id}"`);
    return this.scheduler.runJob(job);
  }
}
