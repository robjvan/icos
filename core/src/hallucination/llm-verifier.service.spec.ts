import type { CoreConfig } from '../config';
import type { ProviderRegistryService } from '../providers/provider-registry.service';
import {
  LlmVerifier,
  parseLabel,
  type VerificationClientFactory,
} from './llm-verifier.service';

const ENDPOINT = {
  provider: 'ollama',
  llmBaseUrl: 'http://localhost:11434/v1',
  llmModel: 'gemma4',
  llmTimeoutMs: 1000,
};

function cfg(overrides: Partial<CoreConfig> = {}): CoreConfig {
  return {
    hallucinationVerifierTimeoutMs: 1000,
    ...overrides,
  } as unknown as CoreConfig;
}

function registry(endpoint: unknown): ProviderRegistryService {
  return {
    endpointForId: () => endpoint,
  } as unknown as ProviderRegistryService;
}

const REQUEST = {
  assertion: { subject: 'user', predicate: 'prefers', object: 'oak' },
  evidenceSummary: 'no active claim matches',
};

const replying: VerificationClientFactory = () => ({
  chat: () =>
    Promise.resolve({
      content: 'The answer is CONTRADICTED.',
      model: 'gemma4',
    }),
});

describe('LlmVerifier (M15.5c)', () => {
  it('is unavailable without a configured provider', async () => {
    const verifier = new LlmVerifier(cfg(), registry(null), () => ({
      chat: () => Promise.resolve({ content: '', model: '' }),
    }));
    expect(verifier.isConfigured()).toBe(false);
    expect((await verifier.verify(REQUEST)).available).toBe(false);
  });

  it('parses the label and records independence against the speaker', async () => {
    const sameSpeaker = new LlmVerifier(
      cfg({ hallucinationVerifierProvider: 'verifier' }),
      registry(ENDPOINT),
      replying,
    );
    expect(
      await sameSpeaker.verify({ ...REQUEST, speakerModel: 'gemma4' }),
    ).toMatchObject({
      available: true,
      backend: 'llm',
      verdict: 'contradicted',
      model: 'gemma4',
      independence: 'self',
    });

    const otherSpeaker = new LlmVerifier(
      cfg({ hallucinationVerifierProvider: 'verifier' }),
      registry(ENDPOINT),
      replying,
    );
    expect(
      await otherSpeaker.verify({ ...REQUEST, speakerModel: 'cloud-llm' }),
    ).toMatchObject({ independence: 'independent' });
  });

  it('fails closed when the verifier call throws', async () => {
    const verifier = new LlmVerifier(
      cfg({ hallucinationVerifierProvider: 'verifier' }),
      registry(ENDPOINT),
      () => ({ chat: () => Promise.reject(new Error('boom')) }),
    );
    expect(await verifier.verify(REQUEST)).toMatchObject({
      available: false,
      backend: 'llm',
    });
  });

  it('parses labels tolerantly', () => {
    expect(parseLabel('SUPPORTED')).toBe('supported');
    expect(parseLabel('  contradicted ')).toBe('contradicted');
    expect(parseLabel('I think unknown, actually')).toBe('unknown');
    expect(parseLabel('gibberish')).toBe('unknown');
  });
});
