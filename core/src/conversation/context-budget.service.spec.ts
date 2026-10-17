import type { CoreConfig } from '../config';
import type { ChatMessage, LlmEndpointConfig } from '../llm/llm.client';
import type { ProviderRegistryService } from '../providers/provider-registry.service';
import {
  ContextBudgetService,
  DEFAULT_CONTEXT_WINDOW,
  estimateText,
} from './context-budget.service';

const user = (content: string): ChatMessage => ({ role: 'user', content });

function config(overrides: Partial<CoreConfig> = {}): CoreConfig {
  return {
    llmMaxOutputTokens: 100,
    contextCompactionEnabled: true,
    contextCompactionTarget: 0.8,
    contextWindowAutodetect: false,
    ...overrides,
  } as unknown as CoreConfig;
}

interface StubState {
  contextWindow?: number;
  baseUrl: string;
  model: string;
}

function stubProviders(): {
  registry: ProviderRegistryService;
  set: (next: Partial<StubState>) => void;
  fire: () => void;
} {
  let listener: (() => void) | null = null;
  const state: StubState = { baseUrl: 'http://localhost:9/v1', model: 'm' };
  const registry = {
    activeEntry: () =>
      state.contextWindow === undefined
        ? null
        : {
            id: 'p',
            model: state.model,
            baseUrl: state.baseUrl,
            contextWindow: state.contextWindow,
          },
    conversationEndpoint: (): LlmEndpointConfig => ({
      provider: 'p',
      llmBaseUrl: state.baseUrl,
      llmModel: state.model,
      llmTimeoutMs: 1000,
    }),
    onChange: (fn: () => void) => {
      listener = fn;
      return () => {
        listener = null;
      };
    },
  } as unknown as ProviderRegistryService;
  return {
    registry,
    set: (next) => {
      Object.assign(state, next);
    },
    fire: () => listener?.(),
  };
}

async function make(
  overrides: Partial<CoreConfig> = {},
  providers = stubProviders(),
): Promise<ContextBudgetService> {
  const budget = new ContextBudgetService(
    config(overrides),
    providers.registry,
  );
  await budget.onModuleInit();
  return budget;
}

describe('ContextBudgetService — window resolution (FG6)', () => {
  it('prefers the provider-declared window (source: provider)', async () => {
    const providers = stubProviders();
    providers.set({ contextWindow: 2000 });
    const budget = await make({ llmContextWindow: 1000 }, providers);
    expect(budget.contextWindow).toBe(2000);
    expect(budget.contextWindowSource).toBe('provider');
  });

  it('falls back to LLM_CONTEXT_WINDOW (source: env)', async () => {
    const budget = await make({ llmContextWindow: 1000 });
    expect(budget.contextWindow).toBe(1000);
    expect(budget.contextWindowSource).toBe('env');
    expect(budget.usableTokens).toBe(900);
    expect(budget.triggerTokens).toBe(720);
  });

  it('uses the conservative default when unresolved (source: default)', async () => {
    const budget = await make();
    expect(budget.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(budget.contextWindowSource).toBe('default');
    expect(budget.contextWindow).toBeGreaterThan(budget.maxOutputTokens);
  });

  it('adopts a probed provider window (source: probe)', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: 'm', context_length: 32000 }] }),
        {
          status: 200,
        },
      ),
    );
    try {
      const budget = await make({ contextWindowAutodetect: true });
      expect(budget.contextWindow).toBe(32000);
      expect(budget.contextWindowSource).toBe('probe');
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('falls back to Ollama /api/show when /models advertises no window', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: string | URL | Request) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.endsWith('/models')) {
          return Promise.resolve(
            new Response(JSON.stringify({ data: [] }), { status: 200 }),
          );
        }
        if (url.endsWith('/api/show')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ model_info: { 'llama.context_length': 8192 } }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response('', { status: 404 }));
      });
    try {
      const budget = await make({ contextWindowAutodetect: true });
      expect(budget.contextWindow).toBe(8192);
      expect(budget.contextWindowSource).toBe('probe');
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('re-resolves when the active provider changes (model switch)', async () => {
    const providers = stubProviders();
    const budget = await make({ llmContextWindow: 1000 }, providers);
    expect(budget.contextWindowSource).toBe('env');

    providers.set({ contextWindow: 32768 });
    providers.fire();
    await Promise.resolve();

    expect(budget.contextWindow).toBe(32768);
    expect(budget.contextWindowSource).toBe('provider');
  });

  it('ignores a superseded probe when the provider changes mid-resolve', async () => {
    const providers = stubProviders();
    let release: (() => void) | undefined;
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = () =>
            resolve(
              new Response(
                JSON.stringify({ data: [{ id: 'm', context_length: 16384 }] }),
                { status: 200 },
              ),
            );
        }),
    );
    try {
      const budget = new ContextBudgetService(
        config({ contextWindowAutodetect: true }),
        providers.registry,
      );
      const stale = budget.resolveWindow(); // slow probe of the old endpoint
      providers.set({ contextWindow: 32768 });
      await budget.resolveWindow(); // model switch wins
      expect(budget.contextWindow).toBe(32768);

      release?.();
      await stale; // the stale probe must not overwrite
      expect(budget.contextWindow).toBe(32768);
      expect(budget.contextWindowSource).toBe('provider');
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('caps the reply reserve at half a small window', async () => {
    const budget = await make({
      llmContextWindow: 1000,
      llmMaxOutputTokens: 900,
    });
    expect(budget.maxOutputTokens).toBe(500);
    expect(budget.usableTokens).toBe(500);
  });
});

describe('ContextBudgetService — accounting', () => {
  it('derives the usable budget and trigger from the window + reserved output', async () => {
    const budget = await make({ llmContextWindow: 1000 });
    expect(budget.contextWindow).toBe(1000);
    expect(budget.usableTokens).toBe(900);
    expect(budget.triggerTokens).toBe(720);
  });

  it('estimates tokens (content + framing) and triggers past the target', async () => {
    const budget = await make({ llmContextWindow: 1000 });
    const small = [user('x'.repeat(400))];
    expect(budget.estimate(small)).toBe(104); // 400/4 + 4 overhead
    expect(budget.shouldCompact(small)).toBe(false);
    expect(budget.shouldCompact([user('x'.repeat(4000))])).toBe(true);
  });

  it('counts extra tokens (tool schemas) toward the estimate', async () => {
    const budget = await make({ llmContextWindow: 1000 });
    expect(budget.estimate([], 800)).toBe(800);
    expect(budget.shouldCompact([], 800)).toBe(true);
  });

  it('never compacts when disabled', async () => {
    const budget = await make({
      llmContextWindow: 1000,
      contextCompactionEnabled: false,
    });
    expect(budget.shouldCompact([user('x'.repeat(100000))])).toBe(false);
  });

  it('estimateText is never zero for non-empty text', () => {
    expect(estimateText('a')).toBe(1);
    expect(estimateText('')).toBe(1);
  });
});
