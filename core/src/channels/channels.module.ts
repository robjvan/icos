import { Module } from '@nestjs/common';
import { coreConfigProvider } from '../config';
import { ConversationModule } from '../conversation/conversation.module';
import { CHANNEL_ADAPTERS } from './channel-adapter';
import { ChannelDatabaseService } from './channel-database.service';
import { ChannelDeliveryService } from './channel-delivery.service';
import { ChannelRepository } from './channel.repository';
import { ChannelsController } from './channels.controller';
import { DiscordAdapter } from './discord.adapter';
import { DiscordIngressService } from './discord-ingress.service';
import { SqliteChannelRepository } from './sqlite-channel.repository';

/**
 * M16 channel subsystem. Self-contained: owns its database service,
 * repository, outbound delivery drainer, and the channel adapters. Isolated
 * from memory and persona by construction.
 *
 * Adapters register through `CHANNEL_ADAPTERS`; a channel with no token
 * (Discord) simply reports unhealthy and never blocks boot.
 */
@Module({
  imports: [ConversationModule],
  controllers: [ChannelsController],
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
    DiscordIngressService,
  ],
  exports: [
    ChannelDatabaseService,
    ChannelRepository,
    ChannelDeliveryService,
    DiscordAdapter,
    DiscordIngressService,
  ],
})
export class ChannelsModule {}
