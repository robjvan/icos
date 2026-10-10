import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { ApprovalService } from '../approvals/approval.service';
import { ConversationService } from '../conversation/conversation.service';
import type { TurnOutcome } from '../conversation/conversation.service';
import { CommandDispatcher } from '../commands/command-dispatcher';
import type { CommandResult } from '../commands/command-result';
import { ChannelDeliveryService } from './channel-delivery.service';
import { ChannelRepository } from './channel.repository';
import type { ChannelMessage } from './channel.types';
import { DiscordAdapter } from './discord.adapter';
import {
  CHAT_STREAM,
  DEFAULT_STREAM_MARKER,
  parseStream,
} from './discord.stream';
import type {
  DiscordCommandInteraction,
  DiscordInbound,
} from './discord.types';

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
    private readonly approvals: ApprovalService,
    private readonly commands: CommandDispatcher,
  ) {}

  /** approvalId → where its card lives, so a button press can resume. */
  private readonly approvalCards = new Map<
    string,
    {
      sessionId: string;
      requestId: string;
      conversationKey: string;
      messageId: string | null;
    }
  >();

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
    this.adapter.onApprovalDecision((decision) => {
      void this.onApprovalDecision(decision).catch((error: unknown) => {
        this.logger.warn(
          `Discord approval decision failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      });
    });
    // M20k: the internal registry is the single source of truth for the
    // native command catalog.
    this.adapter.setCommands(this.commands.commandDescriptors);
    this.adapter.onCommand((command) => {
      void this.handleCommand(command).catch((error: unknown) => {
        this.logger.warn(
          `Discord command failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      });
    });
  }

  /** M20k: a native Discord command → dispatch → reply in the channel/DM. */
  private async handleCommand(
    command: DiscordCommandInteraction,
  ): Promise<void> {
    const key = command.isDm
      ? `discord:dm:${command.authorId}`
      : `discord:${command.guildId}:${command.channelId}`;
    const knownSessionId = await this.repository.findSessionId(key);
    const raw = `/${command.commandName}${
      command.text ? ` ${command.text}` : ''
    }`;
    let result: CommandResult;
    try {
      result = await this.commands.dispatch(raw, knownSessionId ?? undefined);
    } catch (error) {
      await command.reply(
        `⚠️ ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    // A session-switching command (/new, /fork) rebinds this conversation.
    if (result.sessionId && result.sessionId !== knownSessionId) {
      await this.repository
        .recordMessage({
          channel: 'discord',
          direction: 'inbound',
          conversationKey: key,
          peerId: command.authorId,
          sessionId: result.sessionId,
          body: raw,
          externalId: `cmd:${command.interactionId}`,
          provenance: {
            source: 'discord',
            authTrust: 'transport',
            command: command.commandName,
          },
        })
        .catch(() => undefined);
    }
    await command.reply(result.text);
  }

  /** Whether a normalized message should be answered. */
  accepts(message: DiscordInbound): boolean {
    if (message.isDm) {
      if (this.config.discordAllowDirectMessages === false) return false;
      // A DM has no channel to designate — the operator allowlist is the
      // gate, so an unlisted stranger cannot talk to the agent privately.
      return this.isAllowlistedUser(message.authorId);
    }
    if (!this.guildAllowed(message.guildId)) return false;
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
      await this.recordIgnored(message);
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
        {
          sourceBand: this.sourceBand(message),
          attachments: message.attachments,
        },
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
      if (outcome.status === 'approval_required') {
        await this.postApprovalCard(conversationKey, outcome);
      }
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

  /** Post an approval card with buttons and remember it for the decision. */
  private async postApprovalCard(
    conversationKey: string,
    outcome: TurnOutcome,
  ): Promise<void> {
    const approval = outcome.approval;
    if (!approval) return;
    let detail = '';
    try {
      detail = (await this.approvals.get(approval.approvalId)).description;
    } catch {
      detail = '';
    }
    const content = `🤔 Approval needed — ${detail || approval.tool}`;
    const messageId = await this.adapter.postApproval(
      conversationKey,
      approval.approvalId,
      content,
    );
    this.approvalCards.set(approval.approvalId, {
      sessionId: outcome.sessionId,
      requestId: outcome.requestId,
      conversationKey,
      messageId,
    });
  }

  /** A button press: decide the approval, resume the turn, report back. */
  private async onApprovalDecision(decision: {
    approvalId: string;
    approved: boolean;
  }): Promise<void> {
    const card = this.approvalCards.get(decision.approvalId);
    if (!card) return;
    try {
      if (decision.approved) {
        await this.approvals.approve(decision.approvalId, card.sessionId);
      } else {
        await this.approvals.reject(decision.approvalId, card.sessionId);
      }
      const outcome = await this.conversation.resumeTurn(
        card.requestId,
        card.sessionId,
      );
      const reply = (outcome.reply ?? '').trim();
      if (reply) {
        await this.repository.enqueueDelivery({
          channel: 'discord',
          conversationKey: card.conversationKey,
          body: reply,
        });
        void this.delivery.runOnce().catch(() => undefined);
      }
      if (card.messageId) {
        await this.adapter.editCard(
          card.conversationKey,
          card.messageId,
          decision.approved ? '✅ Approved' : '❌ Rejected',
        );
      }
    } finally {
      this.approvalCards.delete(decision.approvalId);
    }
  }

  private isAllowlistedUser(authorId: string): boolean {
    return (this.config.discordAllowedUserIds ?? []).includes(authorId);
  }

  private guildUserAllowed(authorId: string): boolean {
    const allowed = this.config.discordAllowedUserIds ?? [];
    return allowed.length === 0 || allowed.includes(authorId);
  }

  private guildAllowed(guildId: string | null): boolean {
    const allowed = this.config.discordAllowedGuildIds ?? [];
    if (allowed.length === 0) return true;
    return guildId !== null && allowed.includes(guildId);
  }

  /**
   * Record + log a message that targeted the bot but failed the policy.
   * Ambient noise (unmentioned channel chatter) is logged only; a message
   * actually addressed to the bot (DM, mention, or designated channel) is
   * written to the message ledger with `ignored` provenance so a rejected
   * sender is auditable, never silently dropped.
   */
  private async recordIgnored(message: DiscordInbound): Promise<void> {
    const reason = this.rejectReason(message);
    const addressed =
      message.isDm || message.mentionsBot || this.isChatChannel(message);
    if (!addressed) {
      this.logger.debug(
        `Ignoring ambient Discord message in channel ${message.channelId}`,
      );
      return;
    }
    this.logger.log(
      `Ignoring Discord ${message.isDm ? 'DM' : 'message'} from ` +
        `${message.authorId}: ${reason}`,
    );
    try {
      await this.repository.recordMessage({
        channel: 'discord',
        direction: 'inbound',
        conversationKey: this.conversationKey(message),
        peerId: message.authorId,
        body: message.content,
        externalId: message.externalId,
        attachments: message.attachments,
        provenance: {
          source: 'discord',
          authTrust: 'transport',
          ignored: true,
          reason,
          guildId: message.guildId,
          channelId: message.channelId,
        },
      });
    } catch {
      // Duplicate or write failure — this is an audit nicety, never a fault.
    }
  }

  /** Why an addressed message was rejected (for the audit + log). */
  private rejectReason(message: DiscordInbound): string {
    if (message.isDm) {
      return this.config.discordAllowDirectMessages === false
        ? 'direct messages are disabled'
        : 'sender is not in DISCORD_ALLOWED_USER_IDS';
    }
    if (!this.guildAllowed(message.guildId)) {
      return 'guild is not in DISCORD_ALLOWED_GUILD_IDS';
    }
    if (!this.guildUserAllowed(message.authorId)) {
      return 'sender is not in DISCORD_ALLOWED_USER_IDS';
    }
    if (!message.isThread && !message.mentionsBot) {
      return 'channel message did not mention the bot';
    }
    return 'channel is not designated for chat';
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
    return parseStream(message.parentTopic, marker) === CHAT_STREAM;
  }
}
