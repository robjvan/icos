import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { ConversationService } from '../conversation/conversation.service';
import { ChannelDeliveryService } from './channel-delivery.service';
import { ChannelRepository } from './channel.repository';
import type { ChannelMessage } from './channel.types';
import { DiscordAdapter } from './discord.adapter';
import type { DiscordInbound } from './discord.types';

const DEFAULT_STREAM_MARKER = '[icos-stream:';

/** A short, safe Discord thread name derived from the message text. */
function threadName(content: string): string {
  const clean = content.replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 80) : 'ICOS conversation';
}

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
    private readonly delivery: ChannelDeliveryService,
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
    if (message.isDm) {
      if (this.config.discordAllowDirectMessages === false) return false;
      // A DM has no channel to designate — the operator allowlist is the
      // gate, so an unlisted stranger cannot talk to the agent privately.
      return this.isAllowlistedUser(message.authorId);
    }
    if (!this.guildUserAllowed(message.authorId)) return false;
    // A thread continues an existing conversation (no re-mention). A channel
    // message must mention the bot to start one — otherwise we would answer
    // every message in a marked channel.
    if (!message.isThread && !message.mentionsBot) return false;
    return this.isChatChannel(message);
  }

  /** The durable conversation identity for a message (thread-aware). */
  conversationKey(message: DiscordInbound): string {
    if (message.isDm) return `discord:dm:${message.authorId}`;
    const base = `discord:${message.guildId}:${message.parentChannelId}`;
    return message.isThread ? `${base}:thread:${message.channelId}` : base;
  }

  /** Handle one inbound message: record, run a turn, reply in place. */
  async handle(message: DiscordInbound): Promise<void> {
    if (!this.accepts(message)) {
      if (message.isDm) {
        this.logger.log(
          `Ignoring Discord DM from ${message.authorId} — add the id to ` +
            'DISCORD_ALLOWED_USER_IDS to allow it',
        );
      }
      return;
    }

    // Claim the transport id first — a redelivered Discord event must never
    // run the turn twice.
    const seen = await this.repository.findMessageByExternalId(
      'discord',
      message.externalId,
    );
    if (seen) return;

    // A channel mention starts a thread; the conversation lives there so the
    // user can keep talking without re-mentioning. DMs and thread messages
    // keep their own conversation.
    let conversationKey = this.conversationKey(message);
    if (!message.isDm && !message.isThread && message.mentionsBot) {
      const threadId = await this.adapter.startThread(
        message.channelId,
        message.externalId,
        threadName(message.content),
      );
      if (threadId) {
        conversationKey =
          `discord:${message.guildId}:${message.parentChannelId}` +
          `:thread:${threadId}`;
      }
    }

    // Immediate feedback: Discord's native typing indicator.
    void this.adapter.sendTyping?.(conversationKey).catch(() => undefined);

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

    // A "thinking…" placeholder, edited into the reply when it is ready.
    const placeholderId = await this.postPlaceholder(conversationKey);

    try {
      const outcome = await this.conversation.converse(
        message.content,
        knownSessionId ?? undefined,
        { sourceBand: this.sourceBand(message) },
      );
      if (!knownSessionId) {
        await this.repository.updateMessageSession(
          inbound.id,
          outcome.sessionId,
        );
      }
      await this.deliver(
        conversationKey,
        inbound.id,
        (outcome.reply ?? '').trim() || '…',
        placeholderId,
      );
    } catch (error) {
      this.logger.warn(
        `Discord turn failed for ${conversationKey}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      // Fail visibly: never leave the user with a placeholder and silence.
      await this.deliver(
        conversationKey,
        inbound.id,
        '⚠️ Sorry — I hit an error processing that message. Please try again.',
        placeholderId,
      );
    }
  }

  /** Edit the placeholder in place; fall back to the durable queue. */
  private async deliver(
    conversationKey: string,
    inboundId: string,
    body: string,
    placeholderId: string | null,
  ): Promise<void> {
    if (placeholderId) {
      await this.adapter.edit(conversationKey, placeholderId, body);
      return;
    }
    await this.repository
      .enqueueDelivery({
        channel: 'discord',
        conversationKey,
        body,
        replyToMessageId: inboundId,
      })
      .catch(() => undefined);
    void this.delivery.runOnce().catch(() => undefined);
  }

  /** Post the "thinking…" placeholder; null when the send fails. */
  private async postPlaceholder(
    conversationKey: string,
  ): Promise<string | null> {
    try {
      const result = await this.adapter.send(conversationKey, '🤔 thinking…');
      return result.externalMessageId;
    } catch {
      return null;
    }
  }

  private isAllowlistedUser(authorId: string): boolean {
    return (this.config.discordAllowedUserIds ?? []).includes(authorId);
  }

  private guildUserAllowed(authorId: string): boolean {
    const allowed = this.config.discordAllowedUserIds ?? [];
    return allowed.length === 0 || allowed.includes(authorId);
  }

  /** Situational context: where this turn came from, told to the model. */
  private sourceBand(message: DiscordInbound): string {
    const tag = this.adapter.selfName();
    const self = tag ? `You are connected to Discord as @${tag}. ` : '';
    if (message.isDm) {
      return (
        `<source_context>${self}` +
        `This turn arrived as a Discord direct message from user id ` +
        `${message.authorId}.</source_context>`
      );
    }
    return (
      `<source_context>${self}` +
      `This turn arrived in a Discord channel (channel id ` +
      `${message.channelId}, guild ${message.guildId}` +
      `${message.isThread ? ', thread' : ''}).</source_context>`
    );
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
    return this.streamOf(message.parentTopic, marker) === 'chat';
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
