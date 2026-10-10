import type { ChannelAttachment } from './channel.types';

/** The slice of a discord.js attachment this adapter reads. */
export interface DiscordAttachmentLike {
  url: string;
  name?: string | null;
  contentType?: string | null;
  size?: number | null;
}

/** The slice of a discord.js message this adapter reads (structural). */
export interface DiscordMessageLike {
  id: string;
  content: string;
  guildId?: string | null;
  channelId: string;
  author?: { id: string; bot?: boolean } | null;
  mentions?: { has?: (id: string) => boolean } | null;
  attachments?: {
    map: <T>(fn: (attachment: DiscordAttachmentLike) => T) => T[];
  } | null;
  channel?: {
    isTextBased?: () => boolean;
    isThread?: () => boolean;
    parentId?: string | null;
    topic?: string | null;
    /** For a thread, the parent channel (its topic designates the stream). */
    parent?: { topic?: string | null } | null;
  } | null;
}

/** A normalized inbound Discord message, with the policy inputs included. */
export interface DiscordInbound {
  externalId: string;
  channelId: string;
  /** null for a DM. */
  guildId: string | null;
  isDm: boolean;
  isThread: boolean;
  /** True when the message @-mentions the bot (starts a channel thread). */
  mentionsBot: boolean;
  /** The channel itself, or a thread's parent channel. */
  parentChannelId: string;
  channelTopic: string | null;
  /**
   * The topic that designates the stream: a thread's parent topic, or the
   * channel's own. Threads have no topic of their own.
   */
  parentTopic: string | null;
  authorId: string;
  content: string;
  attachments: ChannelAttachment[];
}

export type DiscordMessageHandler = (message: DiscordInbound) => void;

/** A normalized Discord chat-input command interaction (M20k). */
export interface DiscordCommandInteraction {
  commandName: string;
  /** Raw argument text from the `text` option ('' when absent). */
  text: string;
  channelId: string;
  /** null for a DM. */
  guildId: string | null;
  isDm: boolean;
  authorId: string;
  /** Idempotency id (the interaction id). */
  interactionId: string;
  /** Reply to the (already deferred) interaction. */
  reply(content: string): Promise<void>;
}

export type DiscordCommandHandler = (
  command: DiscordCommandInteraction,
) => void;
