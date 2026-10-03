import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { ConversationService } from '../conversation/conversation.service';
import { ChannelRepository } from './channel.repository';
import type { ChannelMessage } from './channel.types';
import { DiscordAdapter } from './discord.adapter';
import type { DiscordInbound } from './discord.types';

const DEFAULT_STREAM_MARKER = '[icos-stream:';

/**
 * M16d inbound Discord. Turns a normalized Discord message into a real
 * ICOS turn: apply the accept policy, claim the transport id (idempotent),
 * map the conversation to one durable session, run the turn, and queue the
 * reply back to the same channel/thread. Fail-soft — a bad message or a
 * model error never crashes the bot.
 */
@Injectable()
export class DiscordIngressService implements OnModuleInit {
  private readonly logger = new Logger(DiscordIngressService.name);

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly adapter: DiscordAdapter,
    private readonly repository: ChannelRepository,
    private readonly conversation: ConversationService,
  ) {}

  onModuleInit(): void {
    this.adapter.onMessage((message) => {
      void this.handle(message).catch((error: unknown) => {
        this.logger.warn(
          `Discord ingress failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      });
    });
  }

  /** Whether a normalized message should be answered. */
  accepts(message: DiscordInbound): boolean {
    if (!this.userAllowed(message.authorId)) return false;
    if (message.isDm) return this.config.discordAllowDirectMessages !== false;
    return this.isChatChannel(message);
  }

  /** The durable conversation identity for a message (thread-aware). */
  conversationKey(message: DiscordInbound): string {
    if (message.isDm) return `discord:dm:${message.authorId}`;
    const base = `discord:${message.guildId}:${message.parentChannelId}`;
    return message.isThread ? `${base}:thread:${message.channelId}` : base;
  }

  /** Handle one inbound message: record, run a turn, queue the reply. */
  async handle(message: DiscordInbound): Promise<void> {
    if (!this.accepts(message)) return;

    const conversationKey = this.conversationKey(message);

    // Claim the transport id first — a redelivered Discord event must never
    // run the turn twice.
    const seen = await this.repository.findMessageByExternalId(
      'discord',
      message.externalId,
    );
    if (seen) return;

    const knownSessionId = await this.repository.findSessionId(conversationKey);
    let inbound: ChannelMessage;
    try {
      inbound = await this.repository.recordMessage({
        channel: 'discord',
        direction: 'inbound',
        conversationKey,
        peerId: message.authorId,
        sessionId: knownSessionId,
        body: message.content,
        externalId: message.externalId,
        attachments: message.attachments,
        provenance: {
          source: 'discord',
          authTrust: 'transport',
          guildId: message.guildId,
          channelId: message.channelId,
          discordUserId: message.authorId,
        },
      });
    } catch {
      // Unique (channel, external_id) collision — a concurrent duplicate.
      return;
    }

    try {
      const outcome = await this.conversation.converse(
        message.content,
        knownSessionId ?? undefined,
      );
      if (!knownSessionId) {
        await this.repository.updateMessageSession(
          inbound.id,
          outcome.sessionId,
        );
      }
      const reply = (outcome.reply ?? '').trim();
      if (reply) {
        await this.repository.enqueueDelivery({
          channel: 'discord',
          conversationKey,
          body: reply,
          replyToMessageId: inbound.id,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Discord turn failed for ${conversationKey}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private userAllowed(authorId: string): boolean {
    const allowed = this.config.discordAllowedUserIds ?? [];
    return allowed.length === 0 || allowed.includes(authorId);
  }

  private isChatChannel(message: DiscordInbound): boolean {
    const allowed = this.config.discordAllowedChannelIds ?? [];
    if (
      allowed.includes(message.channelId) ||
      allowed.includes(message.parentChannelId)
    ) {
      return true;
    }
    const marker = this.config.discordStreamMarker ?? DEFAULT_STREAM_MARKER;
    return this.streamOf(message.channelTopic, marker) === 'chat';
  }

  /** Parse the stream type out of a channel topic: `[icos-stream: chat]`. */
  private streamOf(topic: string | null, marker: string): string | null {
    if (!topic) return null;
    const index = topic.toLowerCase().indexOf(marker.toLowerCase());
    if (index === -1) return null;
    const after = topic.slice(index + marker.length).replace(/^\s+/, '');
    const stream = after.split(/[\s\]]+/)[0];
    return stream ? stream.toLowerCase() : null;
  }
}
