import { Injectable } from '@nestjs/common';
import type { RealtimeEvent } from './realtime-event';
import { RealtimePublisher } from './realtime.publisher';

/**
 * No-op publisher for tests and `REALTIME_ENABLED=false`. The kill
 * switch exists so a transport fault can never take the UI down —
 * clients fall back to polling.
 */
@Injectable()
export class NoopPublisher extends RealtimePublisher {
  override publish(event: RealtimeEvent): void {
    void event;
    // Intentionally silent.
  }
}
