import type { CoreConfig } from '../config';
import type { ChatMessage } from '../llm/llm.client';
import { ContextBudgetService, estimateText } from './context-budget.service';

const user = (content: string): ChatMessage => ({ role: 'user', content });

function config(overrides: Partial<CoreConfig> = {}): CoreConfig {
  return {
    llmContextWindow: 1000,
    llmMaxOutputTokens: 100,
    contextCompactionEnabled: true,
    contextCompactionTarget: 0.8,
    contextWindowAutodetect: false,
    llmBaseUrl: 'http://localhost:9/v1',
    llmModel: 'm',
    ...overrides,
  } as unknown as CoreConfig;
}

describe('ContextBudgetService', () => {
  it('derives the usable budget and trigger from the window + reserved output', () => {
    const budget = new ContextBudgetService(config());
    expect(budget.contextWindow).toBe(1000);
    expect(budget.usableTokens).toBe(900);
    expect(budget.triggerTokens).toBe(720);
  });

  it('estimates tokens (content + framing) and triggers past the target', () => {
    const budget = new ContextBudgetService(config());
    const small = [user('x'.repeat(400))];
    expect(budget.estimate(small)).toBe(104); // 400/4 + 4 overhead
    expect(budget.shouldCompact(small)).toBe(false);
    expect(budget.shouldCompact([user('x'.repeat(4000))])).toBe(true);
  });

  it('counts extra tokens (tool schemas) toward the estimate', () => {
    const budget = new ContextBudgetService(config());
    expect(budget.estimate([], 800)).toBe(800);
    expect(budget.shouldCompact([], 800)).toBe(true);
  });

  it('never compacts when disabled', () => {
    const budget = new ContextBudgetService(
      config({ contextCompactionEnabled: false }),
    );
    expect(budget.shouldCompact([user('x'.repeat(100000))])).toBe(false);
  });

  it('estimateText is never zero for non-empty text', () => {
    expect(estimateText('a')).toBe(1);
    expect(estimateText('')).toBe(1);
  });
});
