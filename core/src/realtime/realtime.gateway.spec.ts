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
});

describe('RealtimePublisher boundary', () => {
  it('gateway implements the publisher interface', () => {
    const gateway = new RealtimeGateway(testConfig());
    expect(gateway).toBeInstanceOf(RealtimePublisher);
    gateway.onModuleDestroy();
  });
});
