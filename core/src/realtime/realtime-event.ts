/**
 * Realtime event envelope. Every server→client frame carries identity
 * and a hint, never authoritative state (D2) — handlers re-read through
 * REST. `health` is the one exception: it carries the full report it
 * renders (derived, volatile; re-fetching would defeat the purpose).
 */
export const REALTIME_PROTOCOL_VERSION = 1;

/** Server→client event types. Both sides mirror this union. */
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
  | 'prospective.created'
  | 'prospective.updated'
  | 'session.updated'
  | 'error';

export const REALTIME_SERVER_EVENT_TYPES: readonly RealtimeServerEventType[] = [
  'hello',
  'heartbeat',
  'health',
  'approval.created',
  'approval.resolved',
  'clarification.created',
  'clarification.resolved',
  'promotion.proposed',
  'promotion.committed',
  'promotion.denied',
  'promotion.failed',
  'claim.updated',
  'prospective.created',
  'prospective.updated',
  'session.updated',
  'error',
];

/** Client→server messages. Subscription + liveness ONLY (D3). */
export type RealtimeClientMessageType =
  'hello' | 'subscribe' | 'unsubscribe' | 'ping';

export const REALTIME_CLIENT_MESSAGE_TYPES: readonly RealtimeClientMessageType[] =
  ['hello', 'subscribe', 'unsubscribe', 'ping'];

export interface RealtimeEvent {
  v: number;
  type: RealtimeServerEventType;
  at: string;
  sessionId?: string;
  payload?: Record<string, unknown>;
}

export function realtimeEvent(
  type: RealtimeServerEventType,
  payload?: Record<string, unknown>,
  sessionId?: string,
): RealtimeEvent {
  return {
    v: REALTIME_PROTOCOL_VERSION,
    type,
    at: new Date().toISOString(),
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(payload !== undefined ? { payload } : {}),
  };
}

export function isRealtimeEvent(value: unknown): value is RealtimeEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    event.v === REALTIME_PROTOCOL_VERSION &&
    typeof event.type === 'string' &&
    (REALTIME_SERVER_EVENT_TYPES as readonly string[]).includes(event.type) &&
    typeof event.at === 'string'
  );
}
