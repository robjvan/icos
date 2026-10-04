import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { CHANNEL_ADAPTERS } from './channel-adapter';
import type { ChannelAdapter } from './channel-adapter';
import { ChannelRepository } from './channel.repository';
import type { ChannelDelivery, ChannelName } from './channel.types';

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_BATCH = 10;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BACKOFF_BASE_MS = 1000;
const DEFAULT_BACKOFF_CAP_MS = 30000;
const DEFAULT_SEND_MIN_INTERVAL_MS = 250;

/**
 * M16b outbound delivery. Drains the durable delivery queue (M16a),
 * sending through the registered channel adapters. A delivery is claimed
 * atomically, attempted once, then marked sent or failed with bounded
 * backoff; after the attempt cap it is abandoned. Fail-soft and unref'd:
 * the pass never blocks a turn and Discord being down never crashes core.
 *
 * discord.js applies its own rate limits; the min-interval here is a
 * courtesy throttle between sends in a single pass.
 */
@Injectable()
export class ChannelDeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChannelDeliveryService.name);
  private readonly adapters = new Map<ChannelName, ChannelAdapter>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly repository: ChannelRepository,
    @Inject(CHANNEL_ADAPTERS) adapters: ChannelAdapter[],
  ) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.name, adapter);
    }
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => {
      void this.runOnce().catch((error: unknown) => {
        this.logger.warn(
          `Delivery pass failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      });
    }, this.intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private get enabled(): boolean {
    return (
      this.adapters.size > 0 && this.config.channelDeliveryEnabled !== false
    );
  }

  private get intervalMs(): number {
    return this.config.channelDeliveryIntervalMs ?? DEFAULT_INTERVAL_MS;
  }

  /** Attempt every currently-due delivery once; returns how many were sent. */
  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let sent = 0;
    try {
      const batch = this.config.channelDeliveryBatch ?? DEFAULT_BATCH;
      for (let i = 0; i < batch; i++) {
        const delivery = await this.repository.claimDueDelivery(
          new Date().toISOString(),
        );
        if (!delivery) break;
        if (await this.attempt(delivery)) sent += 1;
        if (i < batch - 1) {
          await this.throttle();
        }
      }
    } finally {
      this.running = false;
    }
    return sent;
  }

  private async attempt(delivery: ChannelDelivery): Promise<boolean> {
    const adapter = this.adapters.get(delivery.channel);
    if (!adapter || !adapter.isConnected()) {
      await this.fail(
        delivery,
        `channel "${delivery.channel}" is not available`,
      );
      return false;
    }
    try {
      const result = await adapter.send(
        delivery.conversationKey,
        delivery.body,
      );
      await this.repository.markDeliverySent(
        delivery.id,
        result.externalMessageId,
      );
      return true;
    } catch (error) {
      await this.fail(
        delivery,
        error instanceof Error ? error.message : 'send failed',
      );
      return false;
    }
  }

  private async fail(
    delivery: ChannelDelivery,
    message: string,
  ): Promise<void> {
    const maxAttempts =
      this.config.channelDeliveryMaxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    // `claimDueDelivery` already incremented attempts for this try.
    if (delivery.attempts >= maxAttempts) {
      await this.repository.markDeliveryFailed(delivery.id, message, null);
      this.logger.warn(
        `Delivery ${delivery.id} abandoned after ${delivery.attempts} attempt(s): ${message}`,
      );
      return;
    }
    const nextAttemptAt = new Date(
      Date.now() + this.backoffMs(delivery.attempts),
    ).toISOString();
    await this.repository.markDeliveryFailed(
      delivery.id,
      message,
      nextAttemptAt,
    );
  }

  private backoffMs(attempts: number): number {
    const base =
      this.config.channelDeliveryBackoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    const cap =
      this.config.channelDeliveryBackoffCapMs ?? DEFAULT_BACKOFF_CAP_MS;
    const exponential = base * 2 ** Math.max(attempts - 1, 0);
    return Math.min(cap, exponential);
  }

  private throttle(): Promise<void> {
    const ms =
      this.config.channelSendMinIntervalMs ?? DEFAULT_SEND_MIN_INTERVAL_MS;
    return ms > 0
      ? new Promise((resolve) => setTimeout(resolve, ms))
      : Promise.resolve();
  }

  /** Adapter health snapshot for the channel status surface. */
  health(): { channel: ChannelName; connected: boolean; detail?: string }[] {
    return [...this.adapters.values()].map((adapter) => adapter.health());
  }
}
