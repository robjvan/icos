import { Module } from '@nestjs/common';
import { coreConfigProvider } from '../config';
import { ChannelDatabaseService } from './channel-database.service';
import { ChannelRepository } from './channel.repository';
import { SqliteChannelRepository } from './sqlite-channel.repository';

/**
 * M16 channel subsystem (foundation). Self-contained: owns its database
 * service and repository, and exports both so the adapter, delivery, and
 * ingress slices can consume them. Isolated from memory and persona by
 * construction.
 */
@Module({
  providers: [
    coreConfigProvider,
    ChannelDatabaseService,
    { provide: ChannelRepository, useClass: SqliteChannelRepository },
  ],
  exports: [ChannelDatabaseService, ChannelRepository],
})
export class ChannelsModule {}
