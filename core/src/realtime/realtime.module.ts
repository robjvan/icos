import { Inject, Module } from '@nestjs/common';
import { CORE_CONFIG, coreConfigProvider } from '../config';
import type { CoreConfig } from '../config';
import { NoopPublisher } from './noop.publisher';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimePublisher } from './realtime.publisher';

/**
 * Realtime transport: native-`ws` gateway on the existing HTTP server.
 * `REALTIME_ENABLED=false` selects the noop publisher and never attaches
 * the socket — clients fall back to polling, unchanged.
 */
@Module({
  providers: [
    coreConfigProvider,
    RealtimeGateway,
    NoopPublisher,
    {
      provide: RealtimePublisher,
      useFactory: (
        config: CoreConfig,
        gateway: RealtimeGateway,
        noop: NoopPublisher,
      ) => (config.realtimeEnabled ? gateway : noop),
      inject: [CORE_CONFIG, RealtimeGateway, NoopPublisher],
    },
  ],
  exports: [RealtimePublisher, RealtimeGateway],
})
export class RealtimeModule {
  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly gateway: RealtimeGateway,
  ) {}

  attach(httpServer: Parameters<RealtimeGateway['attach']>[0]): void {
    if (this.config.realtimeEnabled) this.gateway.attach(httpServer);
  }
}
