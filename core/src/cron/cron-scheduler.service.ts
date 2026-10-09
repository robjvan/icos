import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConversationService } from '../conversation/conversation.service';
import { CHANNEL_SEND } from '../channels/channel-send.port';
import type { ChannelSendPort } from '../channels/channel-send.port';
import { CronJobRepository } from './cron-job.repository';
import type { CronJob } from './cron-job.repository';
import { nextCronRun } from './cron-expression';

/** Scheduler resolution; a due job runs at most once per pass. */
const TICK_MS = 30_000;

/**
 * M17d in-process cron scheduler. On each tick it runs every enabled job whose
 * `next_run_at` is due: the job's prompt is run as a turn (in the job's
 * session), and the reply is delivered through the channel-send port when the
 * job configured a target. Errors are logged and never crash the tick. A run
 * whose turn parks (an approval-gated tool) leaves the approval pending for
 * the operator — the scheduler does not resume it.
 */
@Injectable()
export class CronScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CronScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private readonly jobs: CronJobRepository,
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject(CHANNEL_SEND)
    private readonly channels?: ChannelSendPort,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One scheduler pass: run every due, enabled job once. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = await this.jobs.due(new Date().toISOString());
      for (const job of due) await this.runJob(job);
    } catch (err) {
      this.logger.warn(`Cron tick failed: ${message(err)}`);
    } finally {
      this.ticking = false;
    }
  }

  /** Run one job now and record the run (also the `run` tool action). */
  async runJob(
    job: CronJob,
  ): Promise<{ reply: string | null; delivered: boolean }> {
    const ranAt = new Date();
    let reply: string | null = null;
    let delivered = false;
    try {
      // Resolved lazily: the conversation service constructs the tool
      // executor, which needs the cron service — a direct injection would
      // be a construction cycle.
      const conversation = this.moduleRef.get(ConversationService, {
        strict: false,
      });
      const outcome = await conversation.converse(
        job.prompt,
        job.sessionId ?? undefined,
      );
      if (outcome.status === 'ok') reply = outcome.reply;
      if (reply && job.deliver && this.channels) {
        await this.channels.send({
          channel: job.deliver.channel,
          target: job.deliver.target,
          ...(job.deliver.id !== undefined ? { id: job.deliver.id } : {}),
          body: reply,
        });
        delivered = true;
      }
    } catch (err) {
      this.logger.warn(`Cron job "${job.name}" failed: ${message(err)}`);
    }
    const next = nextCronRun(job.schedule, ranAt);
    await this.jobs.recordRun(
      job.id,
      ranAt.toISOString(),
      next ? next.toISOString() : null,
    );
    return { reply, delivered };
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error';
}
