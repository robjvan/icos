import type { CoreConfig } from '../config';
import type { MemoryCandidate } from '../memory/memory-candidate';
import { HallucinationGuardService } from './hallucination-guard.service';
import type { ClaimVerifierService } from './claim-verifier.service';
import { HallucinationLedgerRepository } from './hallucination-ledger.repository';
import { HallucinationMitigationService } from './hallucination-mitigation.service';
import type {
  ClaimFinding,
  ClaimVerificationResult,
} from './hallucination.types';

function cfg(): CoreConfig {
  return { llmModel: 'gemma4' } as unknown as CoreConfig;
}

function candidate(
  role: 'user' | 'assistant' | 'unknown',
  overrides: Partial<MemoryCandidate> = {},
): MemoryCandidate {
  return {
    id: 'mc-1',
    kind: 'fact',
    subject: 'user',
    predicate: 'prefers',
    object: 'oak',
    confidence: 0.9,
    importance: 0.7,
    stability: 0.8,
    sourceRole: role,
    negated: false,
    source: { sessionId: 's1', messageId: 1, role },
    extractorModel: 'm',
    extractorVersion: 'v1',
    extractedAt: 't',
    ...overrides,
  };
}

function verificationResult(findings: ClaimFinding[]): ClaimVerificationResult {
  return {
    classification: findings.some((f) => f.mode === 'contradicted_claim')
      ? 'contradicted'
      : 'novel',
    fabricatedClaimIds: [],
    findings,
    reasons: ['deterministic reason'],
    verification: {
      available: false,
      backend: null,
      verdict: 'unknown',
      probability: null,
      model: null,
      independence: 'unknown',
    },
    disagreement: false,
  };
}

function verifierReturning(result: ClaimVerificationResult) {
  const verify = jest.fn(() => Promise.resolve(result));
  return {
    service: { verify } as unknown as ClaimVerifierService,
    verify,
  };
}

function ledger() {
  const record = jest.fn(() => Promise.resolve({ id: 'm1' }));
  return {
    service: {
      record,
      list: () => Promise.resolve([]),
      ping: () => Promise.resolve(),
    } as unknown as HallucinationLedgerRepository,
    record,
  };
}

describe('HallucinationGuardService (M15.5e wiring)', () => {
  it('audits the assistant claims and records the mitigation', async () => {
    const verifier = verifierReturning(
      verificationResult([
        {
          mode: 'contradicted_claim',
          severity: 'critical',
          reason: 'store contradicts',
        },
      ]),
    );
    const log = ledger();
    const guard = new HallucinationGuardService(
      cfg(),
      verifier.service,
      new HallucinationMitigationService(cfg(), log.service),
    );

    const mitigated = await guard.audit([candidate('assistant')]);
    expect(mitigated).toBe(1);
    expect(verifier.verify).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'user', object: 'oak' }),
      'gemma4',
    );
    expect(log.record).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: 'refuse', severity: 'critical' }),
    );
  });

  it('ignores user-sourced claims', async () => {
    const verifier = verifierReturning(verificationResult([]));
    const log = ledger();
    const guard = new HallucinationGuardService(
      cfg(),
      verifier.service,
      new HallucinationMitigationService(cfg(), log.service),
    );
    expect(await guard.audit([candidate('user')])).toBe(0);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('records nothing when there are no findings', async () => {
    const verifier = verifierReturning(verificationResult([]));
    const log = ledger();
    const guard = new HallucinationGuardService(
      cfg(),
      verifier.service,
      new HallucinationMitigationService(cfg(), log.service),
    );
    expect(await guard.audit([candidate('assistant')])).toBe(0);
    expect(log.record).not.toHaveBeenCalled();
  });

  it('is fail-soft: a verifier error never throws', async () => {
    const verify = jest.fn(() => Promise.reject(new Error('verifier down')));
    const guard = new HallucinationGuardService(
      cfg(),
      { verify } as unknown as ClaimVerifierService,
      new HallucinationMitigationService(cfg(), ledger().service),
    );
    await expect(guard.audit([candidate('assistant')])).resolves.toBe(0);
  });
});
