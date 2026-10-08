/**
 * M17c.4: the port the tool executor uses for Discord server/member
 * information and moderation. Keeps the `tools` layer decoupled from
 * discord.js — the channels module provides the implementation (the
 * DiscordAdapter), which owns the client and permission surface.
 */
export const DISCORD_ADMIN = 'DISCORD_ADMIN';

/** A normalized Discord info/moderation request. */
export type DiscordAdminRequest =
  | { action: 'server_info'; guildId?: string }
  | { action: 'member_info'; guildId?: string; userId: string }
  | { action: 'channel_list'; guildId?: string }
  | {
      action: 'timeout_member';
      guildId?: string;
      userId: string;
      durationMs: number;
      reason?: string;
    }
  | {
      action: 'kick_member';
      guildId?: string;
      userId: string;
      reason?: string;
    };

export interface DiscordAdminPort {
  run(request: DiscordAdminRequest): Promise<unknown>;
}
