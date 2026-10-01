import type { CoreConfig } from '../config';
import { NoopPublisher } from './noop.publisher';
import { REALTIME_EVENTS_PATH, RealtimeGateway } from './realtime.gateway';
import { RealtimePublisher } from './realtime.publisher';
import {
  isRealtimeEvent,
  realtimeEvent,
  type RealtimeEvent,
} from './realtime-event';

function testConfig(overrides: Partial<CoreConfig> = {}): CoreConfig {
  return {
    port: 3000,
    host: '127.0.0.1',
    corsAllowedOrigins: ['http://localhost:4200', 'http://127.0.0.1:4200'],
    exposeAcknowledged: false,
    provider: 'ollama',
    llmBaseUrl: 'http://localhost:11434/v1',
    llmModel: 'm',
    llmTimeoutMs: 1000,
    systemPrompt: 'sys',
    maxHistory: 50,
    sessionDbPath: ':memory:',
    memoryDbPath: ':memory:',
    legacyDbPath: '/tmp/icos-test-legacy-missing.sqlite',
    memoryExtractionEnabled: false,
    memoryProvider: 'ollama',
    memoryLlmBaseUrl: 'http://localhost:11434/v1',
    memoryLlmModel: 'm',
    memoryLlmTimeoutMs: 1000,
    memoryPromotionAuto: false,
    memoryPromotionAutoKinds: [],
    memoryProspectiveConfidenceThreshold: 0.5,
    memoryRecallConfidenceGate: 0.3,
    memoryRecallExcludeOrigins: [],
    memoryRecallMaxBandTokens: 800,
    memoryRecallTimeoutMs: 5000,
    memoryMaintenanceEnabled: true,
    memoryMaintenanceIntervalMs: 3600000,
    memoryAgentDampening: 0.5,
    mcpEnabled: false,
    mcpServersPath: '',
    mcpTimeoutMs: 30000,
    mcpReconnectBackoffMs: 60000,
    vectorDbPath: '/tmp/icos-test-claims-vector.db',
    skillsDirPath: '/tmp/icos-test-skills-missing',
    skillsEnabled: true,
    skillsMaxBodyChars: 12000,
    skillsMaxCatalogItems: 50,
    skillsMaxActivePerSession: 5,
    skillsMaxAutoLoadedPerTurn: 2,
    skillsMaxContextChars: 8000,
    agentMaxIterations: 5,
    agentMaxToolSteps: 5,
    agentMaxTurnDurationMs: 900000,
    realtimeEnabled: true,
    realtimeHeartbeatMs: 30000,
    realtimeAllowedOrigins: ['*'],
    ...overrides,
  };
}

describe('realtime-event', () => {
  it('builds versioned envelope frames', () => {
    const event = realtimeEvent('approval.created', { approvalId: 'a1' }, 's1');
    expect(event).toMatchObject({
      v: 1,
      type: 'approval.created',
      sessionId: 's1',
    });
    expect(typeof event.at).toBe('string');
    expect(isRealtimeEvent(event)).toBe(true);
  });

  it('rejects unversioned or unknown event shapes', () => {
    expect(isRealtimeEvent(null)).toBe(false);
    expect(isRealtimeEvent({ v: 1, type: 'mutate', at: 't' })).toBe(false);
    expect(isRealtimeEvent({ v: 2, type: 'hello', at: 't' })).toBe(false);
  });
});

describe('NoopPublisher', () => {
  it('never throws and delivers nothing', () => {
    const noop: RealtimePublisher = new NoopPublisher();
    const event: RealtimeEvent = realtimeEvent('hello', {
      serverTime: 't',
      v: 1,
    });
    expect(() => noop.publish(event)).not.toThrow();
  });
});

describe('RealtimeGateway', () => {
  it('never throws from publish when no server is attached', () => {
    const gateway = new RealtimeGateway(testConfig());
    expect(() =>
      gateway.publish(realtimeEvent('approval.created', { approvalId: 'a1' })),
    ).not.toThrow();
    gateway.onModuleDestroy();
  });

  it('drops malformed events instead of broadcasting them', () => {
    const gateway = new RealtimeGateway(testConfig());
    expect(() =>
      gateway.publish({ v: 1, type: 'mutate', at: 't' } as never),
    ).not.toThrow();
    gateway.onModuleDestroy();
  });

  it('exposes the shared events path', () => {
    expect(REALTIME_EVENTS_PATH).toBe('/core/events');
  });

  it('routes session-scoped events only to subscribed sockets', () => {
    const gateway = new RealtimeGateway(testConfig());
    const internals = gateway as unknown as {
      subscriptions: Map<object, { sessionId?: string }>;
      broadcast(event: RealtimeEvent): void;
    };
    const sentA: string[] = [];
    const sentB: string[] = [];
    const socketA = {
      readyState: 1,
      OPEN: 1,
      bufferedAmount: 0,
      send: (frame: string) => sentA.push(frame),
    };
    const socketB = {
      readyState: 1,
      OPEN: 1,
      bufferedAmount: 0,
      send: (frame: string) => sentB.push(frame),
    };
    // Pre-attach: broadcast without a server goes nowhere, never throws.
    gateway.publish(realtimeEvent('approval.created', {}, 's1'));
    // Fake an attached server so broadcast runs.
    (gateway as unknown as { server: object }).server = {};
    internals.subscriptions.set(socketA, { sessionId: 's1' });
    internals.subscriptions.set(socketB, {});
    internals.broadcast.call(
      gateway,
      realtimeEvent('approval.created', { approvalId: 'a1' }, 's1'),
    );
    expect(sentA).toHaveLength(1);
    expect(sentB).toHaveLength(0);
    // session.updated is global: every socket gets it (sidebar refresh).
    internals.broadcast.call(
      gateway,
      realtimeEvent('session.updated', {}, 's1'),
    );
    expect(sentA).toHaveLength(2);
    expect(sentB).toHaveLength(1);
    gateway.onModuleDestroy();
  });

  it('drops saturated consumers instead of buffering unbounded', () => {
    const gateway = new RealtimeGateway(testConfig());
    const internals = gateway as unknown as {
      subscriptions: Map<object, { sessionId?: string }>;
      broadcast(event: RealtimeEvent): void;
    };
    (gateway as unknown as { server: object }).server = {};
    let slowSends = 0;
    const slow = {
      readyState: 1,
      OPEN: 1,
      bufferedAmount: 4 * 1024 * 1024,
      send: () => slowSends++,
    };
    const fast: string[] = [];
    const fastSocket = {
      readyState: 1,
      OPEN: 1,
      bufferedAmount: 0,
      send: (frame: string) => fast.push(frame),
    };
    internals.subscriptions.set(slow, {});
    internals.subscriptions.set(fastSocket, {});
    internals.broadcast.call(gateway, realtimeEvent('heartbeat', { at: 't' }));
    expect(slowSends).toBe(0);
    expect(fast).toHaveLength(1);
    gateway.onModuleDestroy();
  });

  it('closes unknown client messages instead of acting on them (D3)', () => {
    const gateway = new RealtimeGateway(testConfig());
    const internals = gateway as unknown as {
      handleClientMessage(
        socket: { close: (code: number, reason: string) => void },
        message: { type: string },
      ): void;
      subscriptions: Map<object, object>;
    };
    const closes: number[] = [];
    const socket = { close: (code: number) => closes.push(code) };
    internals.subscriptions.set(socket, {});
    internals.handleClientMessage.call(gateway, socket, { type: 'approve' });
    expect(closes).toEqual([1003]);
    gateway.onModuleDestroy();
  });
});

describe('RealtimePublisher boundary', () => {
  it('gateway implements the publisher interface', () => {
    const gateway = new RealtimeGateway(testConfig());
    expect(gateway).toBeInstanceOf(RealtimePublisher);
    gateway.onModuleDestroy();
  });
});
