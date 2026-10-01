import { Inject, Module } from '@nestjs/common';
import { CORE_CONFIG, coreConfigProvider } from '../config';
import type { CoreConfig } from '../config';
import { AuthModule } from '../auth/auth.module';
import { NoopPublisher } from './noop.publisher';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimePublisher } from './realtime.publisher';

/**
 * Realtime transport: native-`ws` gateway on the existing HTTP server.
 * `REALTIME_ENABLED=false` selects the noop publisher and never attaches
 * the socket — clients fall back to polling, unchanged.
 *
 * ROOM SEMANTICS (learned 2026-09-27): session-scoped events
 * (`approval.*`, `session.updated`, …) are delivered ONLY to sockets
 * subscribed to that session. The global room (no `sessionId`) receives
 * only global events (health/heartbeat/promotion terminals). Clients
 * MUST subscribe with their sessionId after opening a session — the
 * `RealtimeService.resubscribe()` path does this on every session
 * change. A missing subscription is silent by design (no leakage
 * across sessions); missed events are covered by D5 resync.
 */
@Module({
  imports: [AuthModule],
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
      ): RealtimePublisher => (config.realtimeEnabled ? gateway : noop),
      inject: [CORE_CONFIG, RealtimeGateway, NoopPublisher],
    },
  ],
  exports: [RealtimePublisher, RealtimeGateway, NoopPublisher],
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
