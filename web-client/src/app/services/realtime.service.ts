import { Injectable, inject, signal } from '@angular/core';
import { SERVER_URL } from '../../constants';
import { clampHealthIntervalMs, isRealtimeEvent, REALTIME_EVENTS_PATH } from '../models/realtime-event';
import type { RealtimeEvent } from '../models/realtime-event';
import { HealthService } from './health.service';
import { ConversationStore } from './conversation-store';
import { MemoryReviewService } from './memory-review.service';

export type RealtimeTransport = 'ws' | 'polling';

/** Backoff cap: reconnect storms must not thrash core (plan §7). */
export const REALTIME_BACKOFF_CAP_MS = 30000;
/** Base backoff before jitter. Reset on successful `hello`. */
export const REALTIME_BACKOFF_BASE_MS = 1000;

export function backoffDelayMs(attempt: number): number {
  const capped = Math.min(attempt, 10);
  const delay = REALTIME_BACKOFF_BASE_MS * 2 ** capped;
  const jitter = Math.random() * REALTIME_BACKOFF_BASE_MS;
  return Math.min(REALTIME_BACKOFF_CAP_MS, delay + jitter);
}

function eventsUrl(): string {
  const url = new URL(SERVER_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${url.toString().replace(/\/+$/, '')}${REALTIME_EVENTS_PATH}`;
}

/**
 * Socket lifecycle owner. Owns connect/backoff/resubscribe/visibility
 * recovery; owns NO domain state — it routes events into the existing
 * refresh functions (same path as polling, so the degraded path is not
 * a second implementation). Emits the latest event for tests; domain
 * routing lives in `realtime-router.ts`.
 *
 * ROOM CONTRACT: session-scoped events reach only sockets subscribed to
 * that session. Call `trackSession()` whenever the open session changes
 * (and after `hello`, which carries no session yet) — otherwise
 * session-scoped events are silently filtered server-side and only D5
 * resync covers them.
 *
 * Degradation (non-negotiable): socket down ⇒ `connected` false ⇒ the
 * footer polling restarts and the product behaves exactly as today.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly health = inject(HealthService);
  private readonly store = inject(ConversationStore);
  private readonly review = inject(MemoryReviewService);

  /** True after `hello`, false on close/error — drives footer fallback. */
  readonly connected = signal(false);
  readonly transport = signal<RealtimeTransport>('polling');
  readonly lastEventAt = signal<string | null>(null);
  readonly lastEvent = signal<RealtimeEvent | null>(null);

  private socket: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  /** Latest session known to the UI; sent on every (re)subscribe. */
  private trackedSessionId: string | null = null;
  private onOnline = (): void => this.reconnect();
  private onVisible = (): void => {
    if (document.visibilityState === 'visible') this.reconnect();
  };

  /** Start the socket; idempotent. Called once from the dashboard shell. */
  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisible);
    this.connect();
  }

  stop(): void {
    this.started = false;
    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.connected.set(false);
    this.transport.set('polling');
  }

  /** Force a reconnect (online/visible recovery). No-op when up. */
  reconnect(): void {
    if (!this.started || this.socket?.readyState === WebSocket.OPEN) return;
    this.connect();
  }

  private connect(): void {
    if (!this.started) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(eventsUrl());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.sendSubscribe(socket);
    });
    socket.addEventListener('message', (event: MessageEvent) => {
      this.handleFrame(typeof event.data === 'string' ? event.data : null);
    });
    socket.addEventListener('close', () => {
      if (this.socket === socket) {
        this.socket = null;
        this.connected.set(false);
        this.transport.set('polling');
        this.scheduleRetry();
      }
    });
    socket.addEventListener('error', () => {
      // `close` follows `error` on browser sockets; the close handler
      // owns the state transition + retry.
    });
  }

  private scheduleRetry(): void {
    if (!this.started || this.retryTimer) return;
    const delay = backoffDelayMs(this.attempt);
    this.attempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private sendSubscribe(socket: WebSocket): void {
    const healthIntervalMs = clampHealthIntervalMs(
      this.health.pollIntervalSeconds() * 1000,
    );
    // Prefer the explicitly tracked session (set by chat-ui on every
    // session change); fall back to the store's signal for paths that
    // bypass the component (stream `meta` assigns the id mid-turn —
    // the next resubscribe after the turn picks it up).
    const sessionId = this.trackedSessionId ?? this.store.sessionId();
    socket.send(
      JSON.stringify({
        type: 'subscribe',
        ...(sessionId !== null ? { sessionId } : {}),
        healthIntervalMs,
      }),
    );
  }

  /** Re-send the subscription (session change, interval change). */
  resubscribe(): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(this.socket);
    }
  }

  /**
   * Track the open session for room filtering. Call after `openSession`,
   * `newSession`, `sendMessage` (first turn assigns the id via `meta`),
   * and on `hello` (which resubscribes with whatever is current).
   */
  trackSession(sessionId: string | null): void {
    this.trackedSessionId = sessionId;
    this.resubscribe();
  }

  private handleFrame(data: string | null): void {
    if (data === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      return;
    }
    if (!isRealtimeEvent(parsed)) return;
    this.route(parsed);
  }

  private route(event: RealtimeEvent): void {
    this.lastEventAt.set(event.at);
    this.lastEvent.set(event);
    switch (event.type) {
      case 'hello':
        this.attempt = 0;
        this.connected.set(true);
        this.transport.set('ws');
        void this.resync();
        return;
      case 'heartbeat':
        return;
      case 'health':
        this.health.applyPush(event.payload);
        return;
      case 'approval.created':
      case 'approval.resolved':
        void this.store.refreshApprovals();
        // Promotion approvals surface in Review, not chat — refresh the
        // global queue too (same call as the manual refresh path).
        void this.review.refresh();
        return;
      case 'clarification.created':
      case 'clarification.resolved':
        void this.store.refreshQuestions();
        return;
      case 'promotion.proposed':
      case 'promotion.committed':
      case 'promotion.denied':
      case 'promotion.failed':
      case 'claim.updated':
        void this.review.refresh();
        return;
      case 'session.updated':
        void this.store.refreshSessions();
        return;
      case 'error':
        return;
    }
  }

  /**
   * Resync on every (re)connect (D5): the socket only delivers events
   * from while connected, so a full refresh of the cheap idempotent
   * GETs removes the missed-event class without an event log.
   */
  private async resync(): Promise<void> {
    await this.health.refresh();
    await this.store.refreshSessions();
    await this.store.refreshApprovals();
    await this.store.refreshQuestions();
    await this.review.refresh();
  }
}
