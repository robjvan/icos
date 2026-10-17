import { BadRequestException } from '@nestjs/common';
import type { SlashCommandHandler } from '../commands/command-result';
import { registerProviderCommands } from './provider-commands';
import type { ProviderRegistryService } from './provider-registry.service';

interface Call {
  role: string;
  provider: string;
  model?: string;
}

function stub(options: { setActiveThrows?: boolean } = {}): {
  registry: ProviderRegistryService;
  calls: Call[];
} {
  const calls: Call[] = [];
  const entries = [
    {
      id: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'deepseek/x',
    },
    { id: 'local', baseUrl: 'http://localhost:11434/v1', model: 'gemma' },
  ];
  const registry = {
    report: () => ({
      source: 'catalog',
      active: { conversation: 'openrouter', memory: 'local' },
      activeModel: {},
      providers: [
        {
          id: 'openrouter',
          model: 'deepseek/x',
          baseUrl: '',
          enabled: true,
          hasKey: true,
        },
        {
          id: 'local',
          model: 'gemma',
          baseUrl: '',
          enabled: true,
          hasKey: false,
        },
      ],
      errors: [],
      path: '/tmp/providers.json',
    }),
    activeModelFor: () => undefined,
    catalogEntries: () => entries,
    listModels: () =>
      Promise.resolve({
        ok: true,
        detail: 'HTTP 200',
        models: [
          { id: 'deepseek/x', contextWindow: 131072 },
          { id: 'deepseek/y' },
        ],
      }),
    setActive: (role: string, provider: string, model?: string) => {
      if (options.setActiveThrows)
        throw new Error(`unknown provider "${provider}"`);
      calls.push({ role, provider, model });
      return {
        source: 'catalog',
        active: {},
        activeModel: {},
        providers: [],
        errors: [],
        path: '',
      };
    },
  } as unknown as ProviderRegistryService;
  return { registry, calls };
}

function handler(registry: ProviderRegistryService): SlashCommandHandler {
  let captured: SlashCommandHandler | undefined;
  registerProviderCommands(
    (h) => {
      captured = h;
    },
    { registry },
  );
  if (!captured) throw new Error('handler not registered');
  return captured;
}

const ctx = { raw: '/model' };

describe('/model command (FG9c S4)', () => {
  it('shows the active conversation and memory selection', async () => {
    const { registry } = stub();
    const result = await handler(registry).execute(ctx, []);
    expect(result.text).toContain('Conversation: openrouter · deepseek/x');
    expect(result.text).toContain('Memory: local · gemma');
  });

  it('switches provider and model (space-separated)', async () => {
    const { registry, calls } = stub();
    const result = await handler(registry).execute(ctx, [
      'openrouter',
      'deepseek/y',
    ]);
    expect(calls).toEqual([
      { role: 'conversation', provider: 'openrouter', model: 'deepseek/y' },
    ]);
    expect(result.text).toContain('deepseek/y');
  });

  it('switches the model on the active provider (slashy id)', async () => {
    const { registry, calls } = stub();
    await handler(registry).execute(ctx, ['deepseek/deepseek-v4-flash']);
    expect(calls).toEqual([
      {
        role: 'conversation',
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
      },
    ]);
  });

  it('switches the provider when the arg is a known provider id', async () => {
    const { registry, calls } = stub();
    await handler(registry).execute(ctx, ['local']);
    expect(calls).toEqual([
      { role: 'conversation', provider: 'local', model: undefined },
    ]);
  });

  it("lists a provider's advertised models", async () => {
    const { registry } = stub();
    const result = await handler(registry).execute(ctx, ['list', 'openrouter']);
    expect(result.text).toContain('deepseek/x');
    expect(result.text).toContain('131072');
  });

  it('lists the configured providers', async () => {
    const { registry } = stub();
    const result = await handler(registry).execute(ctx, ['list']);
    expect(result.text).toContain('openrouter');
    expect(result.text).toContain('[conversation]');
  });

  it('rejects an unknown provider', async () => {
    const { registry } = stub({ setActiveThrows: true });
    await expect(
      handler(registry).execute(ctx, ['ghost/x']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
