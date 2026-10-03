import { Module } from '@nestjs/common';
import { coreConfigProvider } from '../config';
import { CHANNEL_ADAPTERS } from './channel-adapter';
import { ChannelDatabaseService } from './channel-database.service';
import { ChannelDeliveryService } from './channel-delivery.service';
import { ChannelRepository } from './channel.repository';
import { SqliteChannelRepository } from './sqlite-channel.repository';

/**
 * M16 channel subsystem. Self-contained: owns its database service,
 * repository, and outbound delivery drainer, and exports them so the
 * adapter and ingress slices can consume them. Isolated from memory and
 * persona by construction.
 *
 * `CHANNEL_ADAPTERS` is populated by the adapter slices (M16c onwards);
 * with no adapters the delivery service is inert.
 */
@Module({
  providers: [
    coreConfigProvider,
    ChannelDatabaseService,
    { provide: ChannelRepository, useClass: SqliteChannelRepository },
    { provide: CHANNEL_ADAPTERS, useValue: [] },
    ChannelDeliveryService,
  ],
  exports: [ChannelDatabaseService, ChannelRepository, ChannelDeliveryService],
})
export class ChannelsModule {}
