/**
 * Shared realtime envelope. Single definition mirrored on both sides:
 * core `core/src/realtime/realtime-event.ts` is authoritative; this file
 * mirrors the wire shape. Notify-never-state (D2): events carry identity
 * and a hint; handlers re-read through REST. `health` carries the full
 * report it renders (the one justified exception).
 */
export const REALTIME_PROTOCOL_VERSION = 1;

export const REALTIME_EVENTS_PATH = '/core/events';

export type RealtimeServerEventType =
  | 'hello'
  | 'heartbeat'
  | 'health'
  | 'approval.created'
  | 'approval.resolved'
  | 'clarification.created'
  | 'clarification.resolved'
  | 'promotion.proposed'
  | 'promotion.committed'
  | 'promotion.denied'
  | 'promotion.failed'
  | 'claim.updated'
  | 'session.updated'
  | 'error';

export type RealtimeClientMessageType =
  | 'hello'
  | 'subscribe'
  | 'unsubscribe'
  | 'ping';

export interface RealtimeEvent {
  readonly v: number;
  readonly type: RealtimeServerEventType;
  readonly at: string;
  readonly sessionId?: string;
  readonly payload?: Record<string, unknown>;
}

export function isRealtimeEvent(value: unknown): value is RealtimeEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    event['v'] === REALTIME_PROTOCOL_VERSION &&
    typeof event['type'] === 'string' &&
    typeof event['at'] === 'string'
  );
}

/** Clamp the client-requested health push interval (D4: 1–30 s). */
export function clampHealthIntervalMs(value: number): number {
  if (!Number.isFinite(value)) return 5000;
  return Math.min(30000, Math.max(1000, Math.round(value)));
}
