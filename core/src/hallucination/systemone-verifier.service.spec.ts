import type { CoreConfig } from '../config';
import type { SecretResolver } from '../secrets/secret-resolver';
import {
  SystemoneVerifier,
  type SystemoneFetch,
} from './systemone-verifier.service';

const REQUEST = {
  assertion: { subject: 'user', predicate: 'prefers', object: 'oak' },
  evidenceSummary: 'no active claim matches',
  speakerModel: 'gemma4',
};

function cfg(overrides: Partial<CoreConfig> = {}): CoreConfig {
  return {
    hallucinationVerifierTimeoutMs: 1000,
    ...overrides,
  } as unknown as CoreConfig;
}

function secrets(resolved: string | null = null): SecretResolver {
  return { resolve: () => resolved } as unknown as SecretResolver;
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

const SYSTEMONE_BODY = {
  model: 'jev-style-0.8b-decision-v3',
  answers: {
    verdict: {
      type: 'choice',
      choice: 'contradicted',
      confidence: 0.7,
      probabilities: { supported: 0.1, contradicted: 0.7, unknown: 0.2 },
    },
  },
};

describe('SystemoneVerifier (M15.5c)', () => {
  it('is unavailable without a configured endpoint', async () => {
    const verifier = new SystemoneVerifier(cfg(), secrets(), (() =>
      Promise.resolve(jsonResponse({}))) as unknown as SystemoneFetch);
    expect(verifier.isConfigured()).toBe(false);
    expect((await verifier.verify(REQUEST)).available).toBe(false);
  });

  it('maps a systemone choice to a verdict with the calibrated probability', async () => {
    const verifier = new SystemoneVerifier(
      cfg({ hallucinationDecisionUrl: 'http://jev:8765/' }),
      secrets(),
      (() =>
        Promise.resolve(
          jsonResponse(SYSTEMONE_BODY),
        )) as unknown as SystemoneFetch,
    );
    expect(verifier.isConfigured()).toBe(true);
    expect(await verifier.verify(REQUEST)).toMatchObject({
      available: true,
      backend: 'decision',
      verdict: 'contradicted',
      probability: 0.7,
      model: 'jev-style-0.8b-decision-v3',
      independence: 'independent',
    });
  });

  it('fails closed on an HTTP error or a thrown request', async () => {
    const httpError = new SystemoneVerifier(
      cfg({ hallucinationDecisionUrl: 'http://jev:8765' }),
      secrets(),
      (() =>
        Promise.resolve(
          jsonResponse({ error: 'nope' }, 500),
        )) as unknown as SystemoneFetch,
    );
    expect(await httpError.verify(REQUEST)).toMatchObject({
      available: false,
      backend: 'decision',
    });

    const thrown = new SystemoneVerifier(
      cfg({ hallucinationDecisionUrl: 'http://jev:8765' }),
      secrets(),
      () => Promise.reject(new Error('unreachable')),
    );
    expect(await thrown.verify(REQUEST)).toMatchObject({ available: false });
  });

  it('sends a bearer token when an API key reference resolves', async () => {
    let seen: { headers?: Record<string, string> } | undefined;
    const http = ((
      _url: string,
      init: { headers?: Record<string, string> },
    ): Promise<unknown> => {
      seen = init;
      return Promise.resolve(jsonResponse(SYSTEMONE_BODY));
    }) as unknown as SystemoneFetch;
    const verifier = new SystemoneVerifier(
      cfg({
        hallucinationDecisionUrl: 'http://jev:8765',
        hallucinationDecisionApiKeyRef: 'secret:jev',
      }),
      secrets('k-123'),
      http,
    );
    await verifier.verify(REQUEST);
    expect(seen?.headers?.['authorization']).toBe('Bearer k-123');
  });
});
