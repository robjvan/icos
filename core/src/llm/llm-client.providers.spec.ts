import type { ProviderRegistryService } from '../providers/provider-registry.service';
import type { LlmEndpointConfig } from './llm.client';
import { ConversationLlmClient, MemoryLlmClient } from './llm-client.providers';

function endpoint(overrides: Partial<LlmEndpointConfig>): LlmEndpointConfig {
  return {
    provider: 'a',
    llmBaseUrl: 'http://a/v1',
    llmModel: 'ma',
    llmTimeoutMs: 1000,
    ...overrides,
  };
}

describe('routed LLM clients (S4)', () => {
  it('follows the active conversation provider without a rebuild', () => {
    let current = endpoint({});
    const registry = {
      conversationEndpoint: () => current,
      memoryEndpoint: () => endpoint({ provider: 'mem', llmModel: 'mm' }),
    } as unknown as ProviderRegistryService;
    const client = new ConversationLlmClient(registry);

    expect(client.buildUrl()).toBe('http://a/v1/chat/completions');

    // A reload/second provider switch takes effect on the next call.
    current = endpoint({
      provider: 'b',
      llmBaseUrl: 'http://b/v2',
      llmModel: 'mb',
    });
    expect(client.buildUrl()).toBe('http://b/v2/chat/completions');
  });

  it('routes the memory role through its own endpoint', () => {
    const registry = {
      conversationEndpoint: () => endpoint({}),
      memoryEndpoint: () =>
        endpoint({
          provider: 'mem',
          llmBaseUrl: 'http://mem/v1',
          llmModel: 'mm',
        }),
    } as unknown as ProviderRegistryService;
    const client = new MemoryLlmClient(registry);
    expect(client.buildUrl()).toBe('http://mem/v1/chat/completions');
  });
});
