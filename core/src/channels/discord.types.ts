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
  attachments?: {
    map: <T>(fn: (attachment: DiscordAttachmentLike) => T) => T[];
  } | null;
  channel?: {
    isTextBased?: () => boolean;
    isThread?: () => boolean;
    parentId?: string | null;
    topic?: string | null;
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
  /** The channel itself, or a thread's parent channel. */
  parentChannelId: string;
  channelTopic: string | null;
  authorId: string;
  content: string;
  attachments: ChannelAttachment[];
}

export type DiscordMessageHandler = (message: DiscordInbound) => void;
