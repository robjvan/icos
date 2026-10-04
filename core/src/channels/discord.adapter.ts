import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { SecretResolver } from '../secrets/secret-resolver';
import { parseSecretReference } from '../secrets/reference';
import type {
  ChannelAdapter,
  ChannelHealth,
  ChannelSendResult,
} from './channel-adapter';
import type { ChannelName } from './channel.types';
import {
  DEFAULT_STREAM_MARKER,
  parseStream,
  STATUS_STREAM,
} from './discord.stream';
import type {
  DiscordInbound,
  DiscordMessageHandler,
  DiscordMessageLike,
} from './discord.types';

/** DI token for an injected Discord client factory (tests supply a fake). */
export const DISCORD_CLIENT_FACTORY = 'DISCORD_CLIENT_FACTORY';

/** The slice of discord.js this adapter uses, kept structural for testing. */
export interface DiscordMessageHandle {
  edit(payload: unknown): Promise<unknown>;
  startThread?(options: { name: string }): Promise<{ id: string }>;
}

export interface DiscordChannelLike {
  id?: string;
  topic?: string | null;
  guildId?: string | null;
  isTextBased(): boolean;
  send(payload: unknown): Promise<{ id: string }>;
  sendTyping?(): Promise<void>;
  messages?: { fetch(id: string): Promise<DiscordMessageHandle> };
}

export interface DiscordGuildLike {
  id: string;
  channels: { cache: Map<string, DiscordChannelLike> };
}

export interface DiscordUserLike {
  createDM(): Promise<DiscordChannelLike>;
}

export interface DiscordClientLike {
  login(token: string): Promise<unknown>;
  destroy(): void | Promise<void>;
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  once(event: string, handler: (...args: unknown[]) => void): unknown;
  channels: { fetch(id: string): Promise<DiscordChannelLike | null> };
  users: { fetch(id: string): Promise<DiscordUserLike> };
  guilds?: { cache: Map<string, DiscordGuildLike> };
  user?: { tag?: string } | null;
}

export type DiscordClientFactory = () => Promise<DiscordClientLike>;

const INTENT_NAMES = [
  'Guilds',
  'GuildMessages',
  'MessageContent',
  'DirectMessages',
] as const;

/** A resolved Discord destination. */
export type DiscordTarget =
  { kind: 'channel'; id: string } | { kind: 'dm'; id: string };

/**
 * Resolve the destination from a conversation key:
 *   discord:<guildId>:<channelId>            → channel
 *   discord:<guildId>:<channelId>:thread:<t> → channel (the thread)
 *   discord:dm:<userId>                      → dm (resolve the user, open a DM)
 */
export function parseDiscordTargetKey(
  conversationKey: string,
): DiscordTarget | null {
  const parts = conversationKey.split(':');
  if (parts[0] !== 'discord') return null;
  const threadIndex = parts.indexOf('thread');
  if (threadIndex !== -1) {
    const id = parts[threadIndex + 1];
    return id ? { kind: 'channel', id } : null;
  }
  const id = parts[2];
  if (!id) return null;
  return parts[1] === 'dm' ? { kind: 'dm', id } : { kind: 'channel', id };
}

/**
 * Discord's per-message character limit. A longer body is split across
 * sequential messages rather than being rejected.
 */
export const DISCORD_MESSAGE_LIMIT = 2000;

/**
 * Split `text` into Discord-sized chunks, preferring a newline break, then a
 * space, then a hard cut. The boundary character is kept in the earlier
 * chunk, so `chunks.join('')` is exactly `text`.
 */
export function splitForDiscord(
  text: string,
  limit: number = DISCORD_MESSAGE_LIMIT,
): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit - 1);
    if (cut < 0) cut = rest.lastIndexOf(' ', limit - 1);
    if (cut < 0) {
      chunks.push(rest.slice(0, limit));
      rest = rest.slice(limit);
    } else {
      chunks.push(rest.slice(0, cut + 1));
      rest = rest.slice(cut + 1);
    }
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

/**
 * M16c Discord adapter (outbound + lifecycle). A discord.js client behind
 * the ChannelAdapter boundary: lazy-loaded so its heavy dependency is never
 * pulled in when Discord is disabled, and fail-soft so a bad token or an
 * outage degrades the channel rather than the core. Inbound message
 * handling is M16d.
 */
@Injectable()
export class DiscordAdapter
  implements ChannelAdapter, OnModuleInit, OnModuleDestroy
{
  readonly name: ChannelName = 'discord';
  private readonly logger = new Logger(DiscordAdapter.name);
  private client: DiscordClientLike | null = null;
  private ready = false;
  private statusDetail = 'not started';
  private messageHandler: DiscordMessageHandler | null = null;
  private selfTag: string | null = null;
  private selfId: string | null = null;
  private approvalHandler:
    ((decision: { approvalId: string; approved: boolean }) => void) | null =
    null;
  private readyHandler: (() => void) | null = null;
  private shutdownHandler: (() => Promise<void>) | null = null;

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly secrets: SecretResolver,
    @Optional()
    @Inject(DISCORD_CLIENT_FACTORY)
    private readonly factory?: DiscordClientFactory,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    // The farewell runs while the client is still connected; only then do we
    // tear the client down.
    await this.runShutdownHook();
    await this.disconnect();
  }

  /** Resolve a literal token or a `$VAR` / `secret:NAME` reference. */
  private resolveToken(): string | null {
    const raw = this.config.discordBotToken;
    if (!raw) return null;
    return parseSecretReference(raw) ? this.secrets.resolve(raw) : raw;
  }

  async connect(): Promise<void> {
    if (this.client) return;
    const token = this.resolveToken();
    if (!token) {
      this.statusDetail = 'no token configured';
      return;
    }
    try {
      const { client, readyEvent, messageEvent, interactionEvent } =
        await this.buildClient();
      this.attach(client, readyEvent, messageEvent, interactionEvent);
      await client.login(token);
      this.client = client;
      this.statusDetail = 'connecting';
    } catch (error) {
      this.ready = false;
      this.client = null;
      this.statusDetail =
        error instanceof Error ? error.message : 'connect failed';
      this.logger.error(`Discord connect failed: ${this.statusDetail}`);
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.ready = false;
    this.statusDetail = 'disconnected';
    if (client) {
      try {
        await client.destroy();
      } catch (error) {
        this.logger.warn(
          `Discord destroy failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }
  }

  isConnected(): boolean {
    return this.ready;
  }

  /** Register the inbound message handler (M16d). */
  onMessage(handler: DiscordMessageHandler): void {
    this.messageHandler = handler;
  }

  /** Register the approval-button handler (M16f). */
  onApprovalDecision(
    handler: (decision: { approvalId: string; approved: boolean }) => void,
  ): void {
    this.approvalHandler = handler;
  }

  /**
   * Register a handler fired once when the gateway becomes ready (M16m).
   * If the client is already ready, it fires immediately — so a late
   * registrant never misses the event.
   */
  onReady(handler: () => void): void {
    this.readyHandler = handler;
    if (this.ready) handler();
  }

  /** Register a best-effort handler run on graceful shutdown (M16m). */
  onShutdown(handler: () => Promise<void>): void {
    this.shutdownHandler = handler;
  }

  /**
   * The conversation key of the presence/status channel, or null when none
   * is configured (M16m). Prefers DISCORD_STATUS_CHANNEL_ID; otherwise the
   * first channel whose topic carries the `[icos-stream: status]` marker.
   * The middle key segment is a label — a channel target resolves by id.
   */
  statusTarget(): string | null {
    if (!this.client || !this.ready) return null;
    const explicit = this.config.discordStatusChannelId?.trim();
    if (explicit) return `discord:status:${explicit}`;
    const guilds = this.client.guilds?.cache;
    if (!guilds) return null;
    const marker = this.config.discordStreamMarker ?? DEFAULT_STREAM_MARKER;
    for (const guild of guilds.values()) {
      for (const channel of guild.channels.cache.values()) {
        if (parseStream(channel.topic ?? null, marker) !== STATUS_STREAM) {
          continue;
        }
        if (channel.id) return `discord:${guild.id}:${channel.id}`;
      }
    }
    return null;
  }

  /** The bot's own Discord tag (e.g. `NigelAgent#5144`), once ready. */
  selfName(): string | null {
    return this.selfTag;
  }

  health(): ChannelHealth {
    return {
      channel: this.name,
      connected: this.ready,
      detail: this.statusDetail,
    };
  }

  async send(
    conversationKey: string,
    body: string,
  ): Promise<ChannelSendResult> {
    if (!this.client || !this.ready) {
      throw new Error('discord is not connected');
    }
    const target = parseDiscordTargetKey(conversationKey);
    if (!target) {
      throw new Error(
        `unsupported discord conversation key: ${conversationKey}`,
      );
    }
    const channel = await this.resolveChannel(target);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`discord target ${conversationKey} is not text-based`);
    }
    const chunks = splitForDiscord(body);
    const sent = await channel.send(chunks[0]);
    for (const chunk of chunks.slice(1)) {
      await channel.send(chunk);
    }
    return { externalMessageId: sent.id ?? null };
  }

  /**
   * Show Discord's native "typing…" indicator in a conversation. Best-effort
   * feedback — never throws, so a hiccup cannot break the turn.
   */
  async sendTyping(conversationKey: string): Promise<void> {
    if (!this.client || !this.ready) return;
    const target = parseDiscordTargetKey(conversationKey);
    if (!target) return;
    try {
      const channel = await this.resolveChannel(target);
      await channel?.sendTyping?.();
    } catch {
      // Typing is cosmetic; swallow.
    }
  }

  /** Edit a previously sent message (the "thinking…" placeholder → reply). */
  async edit(
    conversationKey: string,
    messageId: string,
    body: string,
  ): Promise<void> {
    if (!this.client || !this.ready) return;
    const target = parseDiscordTargetKey(conversationKey);
    if (!target) return;
    try {
      const channel = await this.resolveChannel(target);
      const handle = await channel?.messages?.fetch(messageId);
      if (!handle) return;
      const chunks = splitForDiscord(body);
      await handle.edit(chunks[0]);
      for (const chunk of chunks.slice(1)) {
        await channel?.send(chunk);
      }
    } catch (error) {
      this.logger.warn(
        `Discord edit failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /** Start a thread on a message; returns the thread id, or null. */
  async startThread(
    channelId: string,
    messageId: string,
    name: string,
  ): Promise<string | null> {
    if (!this.client || !this.ready) return null;
    try {
      const channel = await this.client.channels.fetch(channelId);
      const handle = await channel?.messages?.fetch(messageId);
      const thread = await handle?.startThread?.({ name });
      return thread?.id ?? null;
    } catch (error) {
      this.logger.warn(
        `Discord thread creation failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  /**
   * Post an approval card with Approve/Reject buttons (M16f). Button ids
   * are `approve:<id>` / `reject:<id>`; the ingress owns the decision.
   * Returns the message id, or null when the post fails.
   */
  async postApproval(
    conversationKey: string,
    approvalId: string,
    content: string,
  ): Promise<string | null> {
    if (!this.client || !this.ready) return null;
    const target = parseDiscordTargetKey(conversationKey);
    if (!target) return null;
    try {
      const channel = await this.resolveChannel(target);
      if (!channel || !channel.isTextBased()) return null;
      const sent = await channel.send({
        content,
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 3,
                label: 'Approve',
                custom_id: `approve:${approvalId}`,
              },
              {
                type: 2,
                style: 4,
                label: 'Reject',
                custom_id: `reject:${approvalId}`,
              },
            ],
          },
        ],
      });
      return sent.id ?? null;
    } catch (error) {
      this.logger.warn(
        `Discord approval post failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  /** Rewrite an approval card and drop its buttons (after a decision). */
  async editCard(
    conversationKey: string,
    messageId: string,
    content: string,
  ): Promise<void> {
    if (!this.client || !this.ready) return;
    const target = parseDiscordTargetKey(conversationKey);
    if (!target) return;
    try {
      const channel = await this.resolveChannel(target);
      const handle = await channel?.messages?.fetch(messageId);
      await handle?.edit({ content, components: [] });
    } catch (error) {
      this.logger.warn(
        `Discord card edit failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /** Fetch the channel for a target; a DM target resolves the user first. */
  private async resolveChannel(
    target: DiscordTarget,
  ): Promise<DiscordChannelLike | null> {
    if (!this.client) return null;
    if (target.kind === 'dm') {
      const user = await this.client.users.fetch(target.id);
      return await user.createDM();
    }
    return await this.client.channels.fetch(target.id);
  }

  private notifyReady(): void {
    try {
      this.readyHandler?.();
    } catch (error) {
      this.logger.warn(
        `Discord ready handler failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async runShutdownHook(): Promise<void> {
    const handler = this.shutdownHandler;
    if (!handler) return;
    try {
      await handler();
    } catch (error) {
      this.logger.warn(
        `Discord shutdown handler failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async buildClient(): Promise<{
    client: DiscordClientLike;
    readyEvent: string;
    messageEvent: string;
    interactionEvent: string;
  }> {
    if (this.factory) {
      return {
        client: await this.factory(),
        readyEvent: 'ready',
        messageEvent: 'messageCreate',
        interactionEvent: 'interactionCreate',
      };
    }
    const mod = await import('discord.js');
    const intents = INTENT_NAMES.map((key) => mod.GatewayIntentBits[key]);
    const client = new mod.Client({
      intents,
      // DMs arrive in channels that are not in the cache — without the
      // Channel partial, Discord never delivers them to the client.
      partials: [mod.Partials.Channel, mod.Partials.Message, mod.Partials.User],
    }) as unknown as DiscordClientLike;
    return {
      client,
      readyEvent: mod.Events.ClientReady ?? 'ready',
      messageEvent: mod.Events.MessageCreate ?? 'messageCreate',
      interactionEvent: mod.Events.InteractionCreate ?? 'interactionCreate',
    };
  }

  private attach(
    client: DiscordClientLike,
    readyEvent: string,
    messageEvent: string,
    interactionEvent: string,
  ): void {
    client.once(readyEvent, (readyClient: unknown) => {
      this.ready = true;
      this.statusDetail = 'connected';
      const tag = (readyClient as { user?: { tag?: string } } | null)?.user
        ?.tag;
      this.selfTag = tag ?? null;
      this.selfId =
        (readyClient as { user?: { id?: string } } | null)?.user?.id ?? null;
      this.logger.log(`Discord ready${tag ? `: ${tag}` : ''}`);
      this.notifyReady();
    });
    client.on('error', (error: unknown) => {
      this.logger.error(
        `Discord client error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
    client.on(messageEvent, (raw: unknown) => this.handleRaw(raw));
    client.on(interactionEvent, (raw: unknown) => this.handleInteraction(raw));
  }

  private handleInteraction(raw: unknown): void {
    if (raw === null || typeof raw !== 'object') return;
    const interaction = raw as {
      isButton?: () => boolean;
      customId?: string;
      deferUpdate?: () => Promise<void>;
    };
    if (!interaction.isButton?.()) return;
    const [action, approvalId] = (interaction.customId ?? '').split(':');
    if ((action !== 'approve' && action !== 'reject') || !approvalId) return;
    void interaction.deferUpdate?.();
    this.approvalHandler?.({ approvalId, approved: action === 'approve' });
  }

  private handleRaw(raw: unknown): void {
    const message = normalizeDiscordMessage(raw, this.selfId ?? undefined);
    if (message && this.messageHandler) {
      this.messageHandler(message);
    }
  }
}

/**
 * Normalize a raw discord.js message into {@link DiscordInbound}, or null
 * when it is not a message the boundary cares about (bot/system authors,
 * non-text channels, empty content). Policy (which channels/DMs and users
 * are accepted) is applied by the ingress, not here.
 */
export function normalizeDiscordMessage(
  raw: unknown,
  botId?: string,
): DiscordInbound | null {
  if (raw === null || typeof raw !== 'object') return null;
  const m = raw as DiscordMessageLike;
  if (m.author?.bot) return null;
  const channel = m.channel;
  if (channel?.isTextBased && !channel.isTextBased()) return null;

  const attachments =
    m.attachments?.map((a) => ({
      url: a.url,
      ...(a.name ? { name: a.name } : {}),
      ...(a.contentType ? { contentType: a.contentType } : {}),
      ...(typeof a.size === 'number' ? { sizeBytes: a.size } : {}),
    })) ?? [];
  if (!m.content && attachments.length === 0) return null;

  const isThread = channel?.isThread?.() ?? false;
  const parentChannelId = isThread
    ? (channel?.parentId ?? m.channelId)
    : m.channelId;
  // A thread has no topic of its own; its parent's topic designates it.
  const parentTopic = isThread
    ? (channel?.parent?.topic ?? null)
    : (channel?.topic ?? null);
  const guildId = m.guildId ?? null;

  return {
    externalId: m.id,
    channelId: m.channelId,
    guildId,
    isDm: guildId === null,
    isThread,
    mentionsBot: botId ? (m.mentions?.has?.(botId) ?? false) : false,
    parentChannelId,
    channelTopic: channel?.topic ?? null,
    parentTopic,
    authorId: m.author?.id ?? 'unknown',
    content: m.content ?? '',
    attachments,
  };
}
