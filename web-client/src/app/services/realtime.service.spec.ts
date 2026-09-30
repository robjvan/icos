import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { clampHealthIntervalMs, isRealtimeEvent } from '../models/realtime-event';

describe('realtime-event', () => {
  it('accepts versioned envelope frames', () => {
    expect(
      isRealtimeEvent({ v: 1, type: 'hello', at: 't', payload: {} }),
    ).toBe(true);
  });

  it('rejects unversioned or malformed frames', () => {
    expect(isRealtimeEvent(null)).toBe(false);
    expect(isRealtimeEvent({ v: 2, type: 'hello', at: 't' })).toBe(false);
    expect(isRealtimeEvent({ v: 1, type: 42, at: 't' })).toBe(false);
  });

  it('clamps the client-requested health interval to 1–30 s', () => {
    expect(clampHealthIntervalMs(5000)).toBe(5000);
    expect(clampHealthIntervalMs(500)).toBe(1000);
    expect(clampHealthIntervalMs(99999)).toBe(30000);
    expect(clampHealthIntervalMs(NaN)).toBe(5000);
  });
});

class FakeSocket {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static readonly CLOSED = 3;
  readyState = FakeSocket.OPEN;
  readonly sent: string[] = [];
  readonly listeners = new Map<string, ((event: { data?: string }) => void)[]>();

  constructor(private readonly hello: string) {}

  addEventListener(type: string, fn: (event: { data?: string }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(): void {
    // No-op for the harness.
  }

  send(frame: string): void {
    this.sent.push(frame);
  }

  close(): void {
    this.readyState = FakeSocket.CLOSED;
    for (const fn of this.listeners.get('close') ?? []) fn({});
  }

  emit(type: string, event: { data?: string }): void {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }

  emitHello(): void {
    this.emit('message', { data: this.hello });
  }
}

describe('RealtimeService', () => {
  const HELLO = JSON.stringify({ v: 1, type: 'hello', at: 't0' });

  // The service reads the statics off the global (`WebSocket.OPEN`), so
  // the stub must carry them, and each construction must return the
  // test's socket instance.
  let current: FakeSocket | null = null;
  class FakeWebSocket {
    static readonly OPEN = 1;
    static readonly CONNECTING = 0;
    constructor() {
      if (!current) throw new Error('no fake socket set');
      return current;
    }
  }

  async function setup() {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const { RealtimeService } = await import('./realtime.service');
    await TestBed.configureTestingModule({
      providers: [
        RealtimeService,
        {
          provide: (await import('./health.service')).HealthService,
          useValue: {
            health: () => null,
            error: () => null,
            pollIntervalSeconds: () => 5,
            refresh: vi.fn().mockResolvedValue(undefined),
            applyPush: vi.fn(),
          },
        },
        {
          provide: (await import('./conversation-store')).ConversationStore,
          useValue: {
            sessionId: () => null,
            refreshSessions: vi.fn().mockResolvedValue(undefined),
            refreshApprovals: vi.fn().mockResolvedValue(undefined),
            refreshQuestions: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: (await import('./memory-review.service')).MemoryReviewService,
          useValue: { refresh: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: (await import('./claim.service')).ClaimService,
          useValue: { notifyUpdated: vi.fn() },
        },
        {
          provide: (await import('./memory-candidate.service')).MemoryCandidateService,
          useValue: { refresh: vi.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compileComponents();
    return TestBed.inject(RealtimeService);
  }

  afterEach(() => {
    current = null;
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('connects, subscribes, and resyncs on hello', async () => {
    const socket = new FakeSocket(HELLO);
    current = socket;
    const service = await setup();
    const store = TestBed.inject(
      (await import('./conversation-store')).ConversationStore,
    ) as unknown as {
      refreshSessions: ReturnType<typeof vi.fn>;
      refreshApprovals: ReturnType<typeof vi.fn>;
      refreshQuestions: ReturnType<typeof vi.fn>;
    };
    service.start();
    socket.emitHello();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.connected()).toBe(true);
    expect(service.transport()).toBe('ws');
    // Resync runs the same cheap refreshes as polling (D5).
    expect(store.refreshSessions).toHaveBeenCalled();
    expect(store.refreshApprovals).toHaveBeenCalled();
    expect(store.refreshQuestions).toHaveBeenCalled();
    // The subscribe goes out on `open` — drive it explicitly since the
    // fake never fires open by itself.
    socket.listeners.get('open')?.forEach((fn) => fn({}));
    const subscribe = JSON.parse(socket.sent[0] ?? '{}') as Record<string, unknown>;
    expect(subscribe['type']).toBe('subscribe');
    expect(subscribe['healthIntervalMs']).toBe(5000);
    service.stop();
  });

  it('applies health pushes without a fetch', async () => {
    const socket = new FakeSocket(HELLO);
    current = socket;
    const service = await setup();
    service.start();
    socket.emitHello();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const health = (
      await import('./health.service')
    ).HealthService;
    void health;
    socket.emit('message', {
      data: JSON.stringify({
        v: 1,
        type: 'health',
        at: 't1',
        payload: {
          status: 'healthy',
          runtime: {},
          host: { os: 'x', memoryUsedBytes: 1, memoryTotalBytes: 2 },
        },
      }),
    });
    expect(service.lastEvent()?.type).toBe('health');
    service.stop();
  });

  it('routes approval and promotion events into existing refreshes', async () => {
    const socket = new FakeSocket(HELLO);
    current = socket;
    const service = await setup();
    const store = TestBed.inject(
      (await import('./conversation-store')).ConversationStore,
    ) as unknown as {
      refreshApprovals: ReturnType<typeof vi.fn>;
      refreshQuestions: ReturnType<typeof vi.fn>;
    };
    const review = TestBed.inject(
      (await import('./memory-review.service')).MemoryReviewService,
    ) as unknown as { refresh: ReturnType<typeof vi.fn> };
    const claims = TestBed.inject(
      (await import('./claim.service')).ClaimService,
    ) as unknown as { notifyUpdated: ReturnType<typeof vi.fn> };
    const ledger = TestBed.inject(
      (await import('./memory-candidate.service')).MemoryCandidateService,
    ) as unknown as { refresh: ReturnType<typeof vi.fn> };
    service.start();
    socket.emitHello();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // hello's own resync already refreshed review/ledger once and bumped
    // claims; clear to assert the routed events alone.
    review.refresh.mockClear();
    ledger.refresh.mockClear();
    claims.notifyUpdated.mockClear();
    socket.emit('message', {
      data: JSON.stringify({ v: 1, type: 'approval.created', at: 't1' }),
    });
    socket.emit('message', {
      data: JSON.stringify({ v: 1, type: 'clarification.resolved', at: 't2' }),
    });
    socket.emit('message', {
      data: JSON.stringify({ v: 1, type: 'promotion.proposed', at: 't3' }),
    });
    socket.emit('message', {
      data: JSON.stringify({ v: 1, type: 'claim.updated', at: 't4' }),
    });
    // Notify-never-state: handlers invoke the identical refresh functions
    // the polling path uses — no domain logic in the router.
    // approval.created → chat + review; promotion.proposed + claim.updated
    // → review + ledger + claims revision (3 review calls from those three
    // events: approval.created, promotion.proposed, claim.updated).
    expect(store.refreshApprovals).toHaveBeenCalled();
    expect(store.refreshQuestions).toHaveBeenCalled();
    expect(review.refresh).toHaveBeenCalledTimes(3);
    expect(ledger.refresh).toHaveBeenCalledTimes(2);
    expect(claims.notifyUpdated).toHaveBeenCalledTimes(2);
    service.stop();
  });

  it('ignores malformed and unversioned frames', async () => {
    const socket = new FakeSocket(HELLO);
    current = socket;
    const service = await setup();
    service.start();
    socket.emit('message', { data: 'not json' });
    socket.emit('message', {
      data: JSON.stringify({ v: 99, type: 'hello', at: 't' }),
    });
    expect(service.connected()).toBe(false);
    expect(service.lastEvent()).toBeNull();
    service.stop();
  });

  it('drops to polling on close and recovers on reconnect with resync', async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket(HELLO);
      current = socket;
      const service = await setup();
      const store = TestBed.inject(
        (await import('./conversation-store')).ConversationStore,
      ) as unknown as {
        refreshSessions: ReturnType<typeof vi.fn>;
      };
      service.start();
      socket.emitHello();
      await Promise.resolve();
      expect(service.connected()).toBe(true);
      const resyncCalls = store.refreshSessions.mock.calls.length;

      // Kill the socket mid-session: client degrades, chat keeps working
      // (fallback polling covers the gap within one footer interval).
      socket.close();
      expect(service.connected()).toBe(false);
      expect(service.transport()).toBe('polling');

      // Backoff retry reconnects; hello resyncs (missed events covered
      // without a replay log).
      const socket2 = new FakeSocket(HELLO);
      current = socket2;
      await vi.runAllTimersAsync();
      socket2.emitHello();
      await Promise.resolve();
      expect(service.connected()).toBe(true);
      expect(store.refreshSessions.mock.calls.length).toBeGreaterThan(resyncCalls);
      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps backoff at 30 s with jitter', async () => {
    const { backoffDelayMs, REALTIME_BACKOFF_CAP_MS } = await import(
      './realtime.service'
    );
    for (let attempt = 0; attempt < 20; attempt++) {
      expect(backoffDelayMs(attempt)).toBeLessThanOrEqual(REALTIME_BACKOFF_CAP_MS);
    }
    // Late attempts saturate the cap (plus ≤1 s jitter).
    expect(backoffDelayMs(10)).toBeGreaterThanOrEqual(REALTIME_BACKOFF_CAP_MS);
  });
});
