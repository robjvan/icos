/**
 * M16 channel model — the unified record of external communication.
 *
 * A `ChannelMessage` is anything that crossed the ICOS boundary: inbound
 * (an external peer addressed the agent) or outbound (the agent, or a
 * human via API, addressed a peer). A `ChannelDelivery` is the durable
 * outbound intent: enqueued, attempted, retried, and finally sent, failed,
 * or abandoned — so a send survives a restart instead of being lost.
 *
 * Neither is a belief. Channel traffic is evidence, exactly like a turn
 * message; extraction still decides whether anything becomes memory.
 */

export type ChannelName = 'discord' | 'email';

export type ChannelDirection = 'inbound' | 'outbound';

export type ChannelDeliveryStatus =
  'pending' | 'sending' | 'sent' | 'failed' | 'abandoned';

export interface ChannelAttachment {
  /** Filename or title, when known. */
  name?: string;
  /** Content type, when known. */
  contentType?: string;
  /** URL or reference. Attachments are recorded as links, never downloaded. */
  url: string;
  /** Size in bytes, when known. */
  sizeBytes?: number;
}

export interface ChannelMessage {
  id: string;
  channel: ChannelName;
  direction: ChannelDirection;
  /** Transport message id (Discord message id, email Message-ID, …). */
  externalId: string | null;
  /**
   * Stable per-channel conversation identity, e.g.
   * `discord:<guildId>:<channelId>` (thread-aware). The same key maps a
   * conversation to one ICOS session for cross-turn continuity.
   */
  conversationKey: string;
  /** External peer (Discord user id, email address), when known. */
  peerId: string | null;
  /** The ICOS session this message maps to, when mapped. */
  sessionId: string | null;
  body: string;
  attachments: ChannelAttachment[];
  /**
   * Transport provenance (source, authTrust, …). Recorded honestly;
   * a transport-level identity is spoofable and is never treated as
   * verified account identity.
   */
  provenance: Record<string, unknown>;
  createdAt: string;
}

export interface NewChannelMessage {
  channel: ChannelName;
  direction: ChannelDirection;
  conversationKey: string;
  body: string;
  externalId?: string | null;
  peerId?: string | null;
  sessionId?: string | null;
  attachments?: ChannelAttachment[];
  provenance?: Record<string, unknown>;
  createdAt?: string;
}

export interface ChannelDelivery {
  id: string;
  channel: ChannelName;
  conversationKey: string;
  body: string;
  /** The outbound channel_message this delivery belongs to, if any. */
  replyToMessageId: string | null;
  status: ChannelDeliveryStatus;
  attempts: number;
  /** ISO time of the next attempt; null when terminal or not scheduled. */
  nextAttemptAt: string | null;
  externalMessageId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewChannelDelivery {
  channel: ChannelName;
  conversationKey: string;
  body: string;
  replyToMessageId?: string | null;
  /** When the first attempt may run; defaults to now. */
  nextAttemptAt?: string | null;
}
