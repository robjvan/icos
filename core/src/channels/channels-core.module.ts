import { Module } from '@nestjs/common';
import { coreConfigProvider } from '../config';
import { CHANNEL_ADAPTERS } from './channel-adapter';
import { ChannelDatabaseService } from './channel-database.service';
import { ChannelDeliveryService } from './channel-delivery.service';
import { ChannelPresenceService } from './channel-presence.service';
import { ChannelRepository } from './channel.repository';
import { ChannelSendService } from './channel-send.service';
import { CHANNEL_SEND } from './channel-send.port';
import { ChannelToolSender } from './channel-tool-sender.service';
import { DiscordAdapter } from './discord.adapter';
import { SqliteChannelRepository } from './sqlite-channel.repository';

/**
 * Channel storage + outbound + adapters, with **no conversation
 * dependency**. The conversation layer imports this module for the
 * `CHANNEL_SEND` port, so the `channel.send` tool can execute without a
 * module cycle (the ingress lives in `ChannelsModule`, which does depend on
 * conversation).
 */
@Module({
  providers: [
    coreConfigProvider,
    ChannelDatabaseService,
    { provide: ChannelRepository, useClass: SqliteChannelRepository },
    DiscordAdapter,
    {
      provide: CHANNEL_ADAPTERS,
      useFactory: (discord: DiscordAdapter) => [discord],
      inject: [DiscordAdapter],
    },
    ChannelDeliveryService,
    ChannelSendService,
    ChannelToolSender,
    ChannelPresenceService,
    { provide: CHANNEL_SEND, useExisting: ChannelToolSender },
  ],
  exports: [
    ChannelDatabaseService,
    ChannelRepository,
    ChannelDeliveryService,
    ChannelSendService,
    ChannelToolSender,
    DiscordAdapter,
    CHANNEL_SEND,
  ],
})
export class ChannelsCoreModule {}
