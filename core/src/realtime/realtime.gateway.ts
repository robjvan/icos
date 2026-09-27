import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import {
  REALTIME_CLIENT_MESSAGE_TYPES,
  isRealtimeEvent,
  realtimeEvent,
  type RealtimeEvent,
} from './realtime-event';
import { RealtimePublisher } from './realtime.publisher';

export const REALTIME_EVENTS_PATH = '/core/events';

/** Oversized frames are closed, never crashed on. */
const MAX_FRAME_BYTES = 1024 * 1024;

/** Heartbeat cadence for liveness-only frames. */
const HEARTBEAT_MS = 30_000;

/** Slow/absent consumers are dropped rather than buffered unbounded. */
const MAX_BUFFERED_BYTES = 1024 * 1024;

interface Subscription {
  sessionId?: string;
  healthIntervalMs?: number;
}

function parseClientMessage(raw: Buffer): {
  type: string;
  sessionId?: string;
  healthIntervalMs?: number;
} | null {
  if (raw.length > MAX_FRAME_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const message = parsed as Record<string, unknown>;
  if (
    typeof message.type !== 'string' ||
    !(REALTIME_CLIENT_MESSAGE_TYPES as readonly string[]).includes(message.type)
  ) {
    return null;
  }
  const out: { type: string; sessionId?: string; healthIntervalMs?: number } = {
    type: message.type,
  };
  if (typeof message.sessionId === 'string') out.sessionId = message.sessionId;
  if (typeof message.healthIntervalMs === 'number') {
    out.healthIntervalMs = message.healthIntervalMs;
  }
  return out;
}

/**
 * Native-`ws` gateway on the existing HTTP server, same port — no new
 * infrastructure, no compose change. Read-only for state (D3): the only
 * client→server messages are subscription + liveness; anything else is
 * rejected. Implements `RealtimePublisher` so services never import
 * socket code.
 */
@Injectable()
export class RealtimeGateway
  extends RealtimePublisher
  implements OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private server: WebSocketServer | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly subscriptions = new Map<WebSocket, Subscription>();

  constructor(@Inject(CORE_CONFIG) private readonly config: CoreConfig) {
    super();
  }

  /** Attach to the Nest HTTP server. No-op unless realtime is enabled. */
  attach(httpServer: Server): void {
    if (!this.config.realtimeEnabled) return;
    if (this.server) return;
    this.server = new WebSocketServer({
      server: httpServer,
      path: REALTIME_EVENTS_PATH,
      maxPayload: MAX_FRAME_BYTES,
    });
    this.server.on('connection', (socket, request) =>
      this.handleConnection(socket, request),
    );
    this.server.on('error', (err) => {
      this.logger.warn(`Realtime gateway error: ${err.message}`);
    });
    this.heartbeatTimer = setInterval(() => {
      this.broadcast(
        realtimeEvent('heartbeat', { at: new Date().toISOString() }),
      );
    }, HEARTBEAT_MS);
    this.heartbeatTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.subscriptions.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  publish(event: RealtimeEvent): void {
    try {
      if (!isRealtimeEvent(event)) return;
      this.broadcast(event);
    } catch (err) {
      // Notifications never fail the mutation they annotate.
      this.logger.warn(
        `Realtime publish failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  /** Sockets subscribed to this session (plus the global room). */
  subscriberCount(sessionId?: string): number {
    let count = 0;
    for (const sub of this.subscriptions.values()) {
      if (sessionId === undefined || sub.sessionId === sessionId) count++;
    }
    return count;
  }

  private handleConnection(
    socket: WebSocket,
    request: {
      headers: Record<string, string | string[] | undefined>;
      url?: string;
    },
  ): void {
    if (!this.originAllowed(request.headers.origin)) {
      socket.close(1008, 'origin not allowed');
      return;
    }
    this.subscriptions.set(socket, {});
    this.send(
      socket,
      realtimeEvent('hello', { serverTime: new Date().toISOString(), v: 1 }),
    );
    socket.on('message', (raw: Buffer) => {
      const message = parseClientMessage(raw);
      if (!message) {
        // Malformed/oversized/unknown: close, never crash (D3 asserts
        // client→server mutation messages are rejected — here every
        // non-protocol message is).
        socket.close(1003, 'unsupported message');
        return;
      }
      this.handleClientMessage(socket, message);
    });
    socket.on('close', () => {
      this.subscriptions.delete(socket);
    });
    socket.on('error', () => {
      this.subscriptions.delete(socket);
    });
  }

  private handleClientMessage(
    socket: WebSocket,
    message: { type: string; sessionId?: string; healthIntervalMs?: number },
  ): void {
    switch (message.type) {
      case 'hello':
      case 'ping':
        this.send(
          socket,
          realtimeEvent('heartbeat', { at: new Date().toISOString() }),
        );
        return;
      case 'subscribe': {
        const sub = this.subscriptions.get(socket) ?? {};
        if (message.sessionId !== undefined) sub.sessionId = message.sessionId;
        if (message.healthIntervalMs !== undefined) {
          sub.healthIntervalMs = Math.min(
            30_000,
            Math.max(1000, Math.round(message.healthIntervalMs)),
          );
        }
        this.subscriptions.set(socket, sub);
        return;
      }
      case 'unsubscribe': {
        const sub = this.subscriptions.get(socket) ?? {};
        if (
          message.sessionId !== undefined &&
          sub.sessionId === message.sessionId
        ) {
          delete sub.sessionId;
        } else if (message.sessionId === undefined) {
          delete sub.sessionId;
          delete sub.healthIntervalMs;
        }
        this.subscriptions.set(socket, sub);
        return;
      }
      default:
        socket.close(1003, 'unsupported message');
    }
  }

  private broadcast(event: RealtimeEvent): void {
    if (!this.server) return;
    const frame = JSON.stringify(event);
    for (const socket of this.subscriptions.keys()) {
      // Drop saturated consumers rather than growing unbounded —
      // a stale notification is covered by client resync.
      if (socket.readyState !== socket.OPEN) continue;
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) continue;
      if (event.sessionId !== undefined) {
        const sub = this.subscriptions.get(socket);
        if (sub?.sessionId !== event.sessionId) continue;
      }
      try {
        socket.send(frame);
      } catch {
        // Per-socket failure never fails the broadcast.
      }
    }
  }

  private send(socket: WebSocket, event: RealtimeEvent): void {
    if (socket.readyState !== socket.OPEN) return;
    try {
      socket.send(JSON.stringify(event));
    } catch {
      // Best-effort.
    }
  }

  private originAllowed(origin: string | string[] | undefined): boolean {
    const allowed = this.config.realtimeAllowedOrigins;
    if (allowed.includes('*')) return true;
    if (typeof origin !== 'string') return false;
    return allowed.includes(origin);
  }
}
