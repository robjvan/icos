import type { CoreConfig } from '../config';
import type { ChatMessage, LlmClient } from '../llm/llm.client';
import { SessionStore } from './session.store';
import { FakeSessionRepository } from './fake-session.repository';
import { ContextBudgetService } from './context-budget.service';
import { ContextCompactionService } from './context-compaction.service';

function config(overrides: Partial<CoreConfig> = {}): CoreConfig {
  return { maxHistory: 50, ...overrides } as unknown as CoreConfig;
}

const user = (content: string): ChatMessage => ({ role: 'user', content });

describe('ContextCompactionService', () => {
  let store: SessionStore;
  let budget: ContextBudgetService;
  let chat: jest.Mock;
  let service: ContextCompactionService;

  beforeEach(() => {
    store = new SessionStore(new FakeSessionRepository(), config());
    budget = new ContextBudgetService(
      config({ llmContextWindow: 1000, llmMaxOutputTokens: 100 }),
    );
    chat = jest.fn(() =>
      Promise.resolve({ content: 'summary text', model: 'm' }),
    );
    service = new ContextCompactionService(config(), store, budget, {
      chat,
    } as unknown as LlmClient);
  });

  async function seed(sessionId: string, count: number): Promise<void> {
    await store.resolve(sessionId);
    for (let i = 0; i < count; i++) {
      await store.append(sessionId, {
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `m${i}`,
      });
    }
  }

  it('folds older turns, keeps recent ones, and stores the summary', async () => {
    await seed('s1', 20);
    const result = await service.compact('s1');
    expect(result).not.toBeNull();
    expect(result?.summarizedMessages).toBe(12); // 20 - 8 keep-recent
    expect(chat).toHaveBeenCalledTimes(1);
    const stored = await service.summaryFor('s1');
    expect(stored?.summary).toBe('summary text');
    expect(stored?.coveredUptoMessageId).toBe(12);
  });

  it('never re-summarizes the covered range', async () => {
    await seed('s1', 20);
    await service.compact('s1');
    // Only 8 new messages remain — all kept, nothing to fold.
    expect(await service.compact('s1')).toBeNull();
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('never splits a turn — folds to a user-message boundary', async () => {
    await seed('s1', 19); // naive boundary lands on an assistant message
    const result = await service.compact('s1');
    expect(result?.summarizedMessages).toBe(10); // walked back to the user turn
  });

  it('returns null when the conversation is shorter than the keep floor', async () => {
    await seed('s1', 5);
    expect(await service.compact('s1')).toBeNull();
    expect(chat).not.toHaveBeenCalled();
  });

  it('compactIfNeeded fires only past the budget trigger', async () => {
    await seed('s1', 20);
    expect(await service.compactIfNeeded('s1', [user('x')])).toBeNull();
    const big = [user('x'.repeat(4000))]; // > trigger (720)
    expect(await service.compactIfNeeded('s1', big)).not.toBeNull();
  });
});
