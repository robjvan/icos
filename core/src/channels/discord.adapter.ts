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

/** DI token for an injected Discord client factory (tests supply a fake). */
export const DISCORD_CLIENT_FACTORY = 'DISCORD_CLIENT_FACTORY';

/** The slice of discord.js this adapter uses, kept structural for testing. */
export interface DiscordChannelLike {
  isTextBased(): boolean;
  send(content: string): Promise<{ id: string }>;
}

export interface DiscordClientLike {
  login(token: string): Promise<unknown>;
  destroy(): void | Promise<void>;
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  once(event: string, handler: (...args: unknown[]) => void): unknown;
  channels: { fetch(id: string): Promise<DiscordChannelLike | null> };
  user?: { tag?: string } | null;
}

export type DiscordClientFactory = () => Promise<DiscordClientLike>;

const INTENT_NAMES = [
  'Guilds',
  'GuildMessages',
  'MessageContent',
  'DirectMessages',
] as const;

/**
 * Resolve the channel id to post to from a conversation key:
 *   discord:<guildId>:<channelId>            → channelId
 *   discord:<guildId>:<channelId>:thread:<t> → t
 *   discord:dm:<userId>                      → unsupported here (M16d)
 */
export function parseDiscordTargetKey(conversationKey: string): string | null {
  const parts = conversationKey.split(':');
  if (parts[0] !== 'discord') return null;
  const threadIndex = parts.indexOf('thread');
  if (threadIndex !== -1 && threadIndex + 1 < parts.length) {
    return parts[threadIndex + 1] || null;
  }
  if (parts[1] === 'dm') return null; // DM send lands with inbound handling (M16d)
  return parts[2] || null;
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
      const { client, readyEvent } = await this.buildClient();
      this.attach(client, readyEvent);
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
    const targetId = parseDiscordTargetKey(conversationKey);
    if (!targetId) {
      throw new Error(
        `unsupported discord conversation key: ${conversationKey}`,
      );
    }
    const channel = await this.client.channels.fetch(targetId);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`discord channel ${targetId} is not text-based`);
    }
    const sent = await channel.send(body);
    return { externalMessageId: sent.id ?? null };
  }

  private async buildClient(): Promise<{
    client: DiscordClientLike;
    readyEvent: string;
  }> {
    if (this.factory) {
      return { client: await this.factory(), readyEvent: 'ready' };
    }
    const mod = await import('discord.js');
    const intents = INTENT_NAMES.map((key) => mod.GatewayIntentBits[key]);
    const client = new mod.Client({ intents }) as unknown as DiscordClientLike;
    return { client, readyEvent: mod.Events.ClientReady ?? 'ready' };
  }

  private attach(client: DiscordClientLike, readyEvent: string): void {
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
    // M16d attaches the inbound MessageCreate handler here.
  }
}
