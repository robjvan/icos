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
import type {
  DiscordInbound,
  DiscordMessageHandler,
  DiscordMessageLike,
} from './discord.types';

/** DI token for an injected Discord client factory (tests supply a fake). */
export const DISCORD_CLIENT_FACTORY = 'DISCORD_CLIENT_FACTORY';

/** The slice of discord.js this adapter uses, kept structural for testing. */
export interface DiscordChannelLike {
  isTextBased(): boolean;
  send(content: string): Promise<{ id: string }>;
  sendTyping?(): Promise<void>;
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
      const { client, readyEvent, messageEvent } = await this.buildClient();
      this.attach(client, readyEvent, messageEvent);
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
    const sent = await channel.send(body);
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

  private async buildClient(): Promise<{
    client: DiscordClientLike;
    readyEvent: string;
    messageEvent: string;
  }> {
    if (this.factory) {
      return {
        client: await this.factory(),
        readyEvent: 'ready',
        messageEvent: 'messageCreate',
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
    };
  }

  private attach(
    client: DiscordClientLike,
    readyEvent: string,
    messageEvent: string,
  ): void {
    client.once(readyEvent, (readyClient: unknown) => {
      this.ready = true;
      this.statusDetail = 'connected';
      const tag = (readyClient as { user?: { tag?: string } } | null)?.user
        ?.tag;
      this.logger.log(`Discord ready${tag ? `: ${tag}` : ''}`);
    });
    client.on('error', (error: unknown) => {
      this.logger.error(
        `Discord client error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
    client.on(messageEvent, (raw: unknown) => this.handleRaw(raw));
  }

  private handleRaw(raw: unknown): void {
    const message = normalizeDiscordMessage(raw);
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
export function normalizeDiscordMessage(raw: unknown): DiscordInbound | null {
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
    parentChannelId,
    channelTopic: channel?.topic ?? null,
    parentTopic,
    authorId: m.author?.id ?? 'unknown',
    content: m.content ?? '',
    attachments,
  };
}
