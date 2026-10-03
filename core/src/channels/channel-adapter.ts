import type { ChannelName } from './channel.types';

export interface ChannelSendResult {
  /** The transport's own id for the delivered message, when it returns one. */
  externalMessageId: string | null;
}

export interface ChannelHealth {
  channel: ChannelName;
  connected: boolean;
  /** Why the channel is unusable, when it is. */
  detail?: string;
}

/**
 * The boundary every external transport implements. Core depends on this,
 * never on discord.js (or Brevo) directly, so a channel is a swappable
 * adapter and a disabled or absent channel simply reports unhealthy —
 * it never blocks the core.
 */
export interface ChannelAdapter {
  readonly name: ChannelName;

  /** Establish the connection. Idempotent; fail-soft (never throws fatally). */
  connect(): Promise<void>;

  disconnect(): Promise<void>;

  /** Whether the adapter can currently send. */
  isConnected(): boolean;

  health(): ChannelHealth;

  /**
   * Deliver `body` to the conversation identified by `conversationKey`
   * (e.g. `discord:<guildId>:<channelId>`). Throws on failure; the
   * delivery service owns retries and backoff.
   */
  send(conversationKey: string, body: string): Promise<ChannelSendResult>;

  /** Optional best-effort "processing" feedback (a typing indicator). */
  sendTyping?(conversationKey: string): Promise<void>;
}

/** DI token: the set of adapters the delivery service may use. */
export const CHANNEL_ADAPTERS = 'CHANNEL_ADAPTERS';
