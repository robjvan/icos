import { RecallTraceStore } from './recall-trace.store';
import type { RecallTrace } from './recall-trace.store';

const trace = (sessionId: string): Omit<RecallTrace, 'at'> => ({
  sessionId,
  query: { text: 'hi', tokens: ['hi'] },
  surfaces: {},
  ranked: [],
  notes: [],
  proposedQuestions: [],
  lens: { exclude: [] },
  gate: 0.3,
  bands: { memory: false, kb: false },
  kbAvailable: false,
  degraded: [],
});

describe('RecallTraceStore', () => {
  it('keeps the last trace per session', () => {
    const store = new RecallTraceStore();
    expect(store.get('s1')).toBeNull();

    const saved = store.save(trace('s1'));
    expect(saved.at).toBeDefined();
    expect(store.get('s1')?.query.text).toBe('hi');

    store.save({ ...trace('s1'), query: { text: 'yo', tokens: ['yo'] } });
    expect(store.get('s1')?.query.text).toBe('yo');
  });

  it('bounds the log, evicting oldest first', () => {
    const store = new RecallTraceStore();
    for (let i = 0; i < 105; i++) store.save(trace(`s${i}`));
    expect(store.get('s0')).toBeNull();
    expect(store.get('s104')).toBeDefined();
  });
});
