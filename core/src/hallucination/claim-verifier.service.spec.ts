import type { ClaimConsistencyService } from './claim-consistency.service';
import { ClaimVerifierService } from './claim-verifier.service';
import type {
  ClaimConsistencyResult,
  VerificationVerdictLabel,
} from './hallucination.types';
import type { LlmVerifier } from './llm-verifier.service';
import type { SystemoneVerifier } from './systemone-verifier.service';

const ASSERTION = {
  subject: 'user',
  predicate: 'prefers',
  object: 'oak',
  confidence: 0.9,
};

function consistency(
  overrides: Partial<ClaimConsistencyResult> = {},
): ClaimConsistencyService {
  return {
    classify: () =>
      Promise.resolve({
        classification: 'novel',
        fabricatedClaimIds: [],
        findings: [
          {
            mode: 'unsupported_claim',
            severity: 'warning',
            reason: 'novel',
          },
        ],
        reasons: ['No active claim matches.'],
        ...overrides,
      }),
  } as unknown as ClaimConsistencyService;
}

function fakeDecision(
  configured: boolean,
  verdict: VerificationVerdictLabel = 'contradicted',
) {
  const verify = jest.fn(() =>
    Promise.resolve({
      available: true,
      backend: 'decision' as const,
      verdict,
      probability: 0.7,
      model: 'jev-style-0.8b-decision-v3',
      independence: 'independent' as const,
    }),
  );
  return {
    service: {
      isConfigured: () => configured,
      verify,
    } as unknown as SystemoneVerifier,
    verify,
  };
}

function fakeLlm(configured: boolean) {
  const verify = jest.fn(() =>
    Promise.resolve({
      available: true,
      backend: 'llm' as const,
      verdict: 'supported' as const,
      probability: null,
      model: 'gemma4',
      independence: 'self' as const,
    }),
  );
  return {
    service: {
      isConfigured: () => configured,
      verify,
    } as unknown as LlmVerifier,
    verify,
  };
}

describe('ClaimVerifierService (M15.5c)', () => {
  it('prefers the decision tier over the llm tier', async () => {
    const decision = fakeDecision(true);
    const llm = fakeLlm(true);
    const service = new ClaimVerifierService(
      consistency(),
      decision.service,
      llm.service,
    );
    expect(service.activeBackend()).toBe('decision');
    const result = await service.verify(ASSERTION);
    expect(decision.verify).toHaveBeenCalled();
    expect(llm.verify).not.toHaveBeenCalled();
    expect(result.disagreement).toBe(true);
    expect(result.verification.backend).toBe('decision');
  });

  it('falls back to the llm tier when no decision endpoint is set', async () => {
    const decision = fakeDecision(false);
    const llm = fakeLlm(true);
    const service = new ClaimVerifierService(
      consistency(),
      decision.service,
      llm.service,
    );
    expect(service.activeBackend()).toBe('llm');
    await service.verify(ASSERTION);
    expect(llm.verify).toHaveBeenCalled();
  });

  it('flags an unresolvable high-stakes assertion when no verifier exists', async () => {
    const service = new ClaimVerifierService(
      consistency(),
      fakeDecision(false).service,
      fakeLlm(false).service,
    );
    const result = await service.verify(ASSERTION);
    expect(service.activeBackend()).toBeNull();
    expect(result.verification.available).toBe(false);
    expect(result.findings.map((finding) => finding.mode)).toContain(
      'unverifiable_high_stakes',
    );
  });

  it('does not verify a low-stakes assertion', async () => {
    const decision = fakeDecision(true);
    const service = new ClaimVerifierService(
      consistency(),
      decision.service,
      fakeLlm(false).service,
    );
    const result = await service.verify({ ...ASSERTION, confidence: 0.3 });
    expect(decision.verify).not.toHaveBeenCalled();
    expect(result.verification.available).toBe(false);
    expect(result.findings.map((finding) => finding.mode)).not.toContain(
      'unverifiable_high_stakes',
    );
  });

  it('records agreement without a disagreement flag', async () => {
    const decision = fakeDecision(true, 'supported');
    const service = new ClaimVerifierService(
      consistency({ classification: 'supported' }),
      decision.service,
      fakeLlm(false).service,
    );
    const result = await service.verify(ASSERTION);
    expect(result.disagreement).toBe(false);
  });
});
