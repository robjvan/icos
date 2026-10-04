import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { ChannelDeliveryService } from './channel-delivery.service';
import { ChannelRepository } from './channel.repository';
import { DiscordAdapter } from './discord.adapter';

/** Default lifecycle messages (override with DISCORD_PRESENCE_ONLINE/_OFFLINE). */
export const DEFAULT_PRESENCE_ONLINE =
  '♻️ Gateway online — ICOS is back and ready.';
export const DEFAULT_PRESENCE_OFFLINE =
  '⚠️ Gateway shutting down — the current task may be interrupted.';

/** The farewell must not hang shutdown; keep it short. */
const SHUTDOWN_TIMEOUT_MS = 2000;

/**
 * M16m presence messages. Announce the runtime's lifecycle in a designated
 * status channel, so an operator watching Discord sees the bot come up and
 * go down.
 *
 * - **Online**: once per process start (a reconnect does not re-announce),
 *   through the durable delivery queue, so it is retried like any send.
 * - **Offline**: best-effort on graceful shutdown, sent directly with a
 *   bounded timeout — the queue no longer drains once the process stops.
 *   A hard kill sends nothing; that is honest, not a bug.
 *
 * No status channel configured is a normal state: nothing is sent, and
 * nothing errors.
 */
@Injectable()
export class ChannelPresenceService implements OnModuleInit {
  private readonly logger = new Logger(ChannelPresenceService.name);
  private announced = false;

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly adapter: DiscordAdapter,
    private readonly repository: ChannelRepository,
    private readonly delivery: ChannelDeliveryService,
  ) {}

  onModuleInit(): void {
    this.adapter.onReady(() => {
      void this.announceOnline().catch((error: unknown) => {
        this.logger.warn(
          `Presence online failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      });
    });
    // The adapter runs this while the client is still connected.
    this.adapter.onShutdown(() => this.announceOffline());
  }

  /** Announce "online" once per process start, through the durable queue. */
  async announceOnline(): Promise<void> {
    if (this.config.discordPresenceEnabled === false) return;
    if (this.announced) return;
    this.announced = true;
    const target = this.adapter.statusTarget();
    if (!target) return;
    await this.repository.enqueueDelivery({
      channel: 'discord',
      conversationKey: target,
      body: this.config.discordPresenceOnline ?? DEFAULT_PRESENCE_ONLINE,
    });
    void this.delivery.runOnce().catch(() => undefined);
  }

  /** Best-effort farewell on graceful shutdown. */
  async announceOffline(): Promise<void> {
    if (this.config.discordPresenceEnabled === false) return;
    const target = this.adapter.statusTarget();
    if (!target) return;
    const body = this.config.discordPresenceOffline ?? DEFAULT_PRESENCE_OFFLINE;
    await withTimeout(this.adapter.send(target, body), SHUTDOWN_TIMEOUT_MS);
  }
}

/** Reject after `ms` so a stalled send cannot block shutdown. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('presence send timed out')),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
