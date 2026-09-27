import type { RealtimeEvent } from './realtime-event';

/**
 * Notification boundary. Services emit identity-and-hint events; the
 * gateway delivers them. `publish()` is synchronous and never throws —
 * a failed notification must never fail a turn, a promotion, or an
 * approval (precedent: indexing is best-effort, it never fails a commit).
 * Mirrors the `ClaimIndex` boundary pattern: services depend on this
 * interface, the module binds the gateway, tests inject the noop.
 */
export abstract class RealtimePublisher {
  abstract publish(event: RealtimeEvent): void;
}
