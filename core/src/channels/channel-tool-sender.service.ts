import { Inject, Injectable } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { ChannelSendService } from './channel-send.service';
import type { ChannelSendPort, ChannelSendRequest } from './channel-send.port';

/**
 * The `channel.send` tool port implementation (M16e.2). It resolves a
 * normalized request to a conversation key, constraining the target to the
 * allowlist, then hands off to {@link ChannelSendService}. Kept separate
 * from the conversation layer so the tools module stays decoupled.
 */
@Injectable()
export class ChannelToolSender implements ChannelSendPort {
  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly sender: ChannelSendService,
  ) {}

  async send(
    request: ChannelSendRequest,
  ): Promise<{ messageId: string; deliveryId: string }> {
    const conversationKey = this.resolveKey(request);
    const { message, delivery } = await this.sender.send({
      channel: request.channel,
      conversationKey,
      body: request.body,
      provenance: { source: 'agent-tool' },
    });
    return { messageId: message.id, deliveryId: delivery.id };
  }

  /** Resolve + allowlist-check the target; throws on a disallowed target. */
  private resolveKey(request: ChannelSendRequest): string {
    if (request.channel === 'email') {
      return this.resolveEmailKey(request);
    }
    return this.resolveDiscordKey(request);
  }

  private resolveDiscordKey(request: ChannelSendRequest): string {
    if (request.target === 'operator') {
      const operator = (this.config.discordAllowedUserIds ?? [])[0];
      if (!operator) throw new Error('no_operator_allowlisted');
      return `discord:dm:${operator}`;
    }
    if (request.target === 'channel') {
      if (
        !request.id ||
        !(this.config.discordAllowedChannelIds ?? []).includes(request.id)
      ) {
        throw new Error('target_not_allowed');
      }
      return `discord:channel:${request.id}`;
    }
    if (
      !request.id ||
      !(this.config.discordAllowedUserIds ?? []).includes(request.id)
    ) {
      throw new Error('target_not_allowed');
    }
    return `discord:dm:${request.id}`;
  }

  /**
   * Email has no channels; `operator` is the first allowlisted recipient and
   * `user` must be an allowlisted recipient. Match is case-insensitive and the
   * configured (canonical) address is used.
   */
  private resolveEmailKey(request: ChannelSendRequest): string {
    const allowed = this.config.emailAllowedRecipients ?? [];
    if (request.target === 'channel') {
      throw new Error('email_has_no_channels');
    }
    if (request.target === 'operator') {
      const operator = allowed[0];
      if (!operator) throw new Error('no_operator_allowlisted');
      return `email:${operator}`;
    }
    const id = request.id?.trim();
    if (!id) throw new Error('target_not_allowed');
    const match = allowed.find(
      (recipient) => recipient.toLowerCase() === id.toLowerCase(),
    );
    if (!match) throw new Error('target_not_allowed');
    return `email:${match}`;
  }
}
