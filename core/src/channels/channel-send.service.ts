import { Injectable, Logger } from '@nestjs/common';
import { ChannelDeliveryService } from './channel-delivery.service';
import { ChannelRepository } from './channel.repository';
import type {
  ChannelDelivery,
  ChannelMessage,
  ChannelName,
} from './channel.types';

/**
 * M16e outbound initiation, shared by the HTTP API and (M16e.2) the agent
 * `channel.send` tool. It records an outbound `channel_message` and enqueues
 * a durable delivery, then nudges the drainer so the message posts promptly
 * rather than waiting for the next poll tick.
 *
 * Recipient validation is the caller's: the admin HTTP path is trusted
 * (operator-authenticated); the agent tool will constrain targets to the
 * channel allowlist before calling here.
 */
@Injectable()
export class ChannelSendService {
  private readonly logger = new Logger(ChannelSendService.name);

  constructor(
    private readonly repository: ChannelRepository,
    private readonly delivery: ChannelDeliveryService,
  ) {}

  async send(input: {
    channel: ChannelName;
    conversationKey: string;
    body: string;
    provenance?: Record<string, unknown>;
  }): Promise<{ message: ChannelMessage; delivery: ChannelDelivery }> {
    const message = await this.repository.recordMessage({
      channel: input.channel,
      direction: 'outbound',
      conversationKey: input.conversationKey,
      body: input.body,
      provenance: input.provenance ?? { source: 'operator' },
    });
    const delivery = await this.repository.enqueueDelivery({
      channel: input.channel,
      conversationKey: input.conversationKey,
      body: input.body,
    });
    void this.delivery.runOnce().catch((error: unknown) => {
      this.logger.warn(
        `Delivery pass failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    });
    return { message, delivery };
  }
}
