import type { Claim } from '../memory/claim';
import { identityKey } from '../memory/claim-identity';
import type { ClaimRepository } from '../memory/claim.repository';
import { ClaimConsistencyService } from './claim-consistency.service';
import { ClaimVerifierService } from './claim-verifier.service';
import {
  HALLUCINATION_BENIGN_BASELINES,
  HALLUCINATION_FAILURE_MODES,
  type HallucinationFailureMode,
  type MitigationPosture,
} from './hallucination-modes';
import { HallucinationLedgerRepository } from './hallucination-ledger.repository';
import { HallucinationMitigationService } from './hallucination-mitigation.service';
import type { LlmVerifier } from './llm-verifier.service';
import type { SystemoneVerifier } from './systemone-verifier.service';
import type { CoreConfig } from '../config';

const ASSERTION = { subject: 'user', predicate: 'prefers', object: 'oak' };

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'claim-1',
    subject: 'user',
    predicate: 'prefers',
    object: 'oak',
    category: 'preference',
    status: 'active',
    extractorConfidence: 0.9,
    confidence: 0.9,
    firstAssertedAt: 't',
    lastSurfacedAt: 't',
    origin: 'user',
    negated: false,
    evidence: [{ candidateId: 'e1', role: 'user' }],
    entities: [],
    promotion: 'NEW',
    sourceType: null,
    summary: null,
    related: [],
    timesObserved: 1,
    accessCount: 0,
    lastAccessedAt: null,
    activation: null,
    locked: false,
    emotional: null,
    createdAt: 't',
    updatedAt: 't',
    ...overrides,
  };
}

function repo(claims: Claim[]): ClaimRepository {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const byTriple = new Map(
    claims.map((c) => [`${identityKey(c)}|${c.negated ? 1 : 0}`, c]),
  );
  return {
    findByTriple: (triple: {
      subject: string;
      predicate: string;
      object: string;
      negated?: boolean;
    }) =>
      Promise.resolve(
        byTriple.get(`${identityKey(triple)}|${triple.negated ? 1 : 0}`) ??
          null,
      ),
    getClaim: (id: string) => Promise.resolve(byId.get(id) ?? null),
  } as unknown as ClaimRepository;
}

function cfg(posture?: Partial<MitigationPosture>): CoreConfig {
  return { hallucinationMitigationPosture: posture } as unknown as CoreConfig;
}

function fakeVerifier(
  configured: boolean,
  verdict: 'supported' | 'contradicted' | 'unknown',
) {
  return {
    isConfigured: () => configured,
    verify: () =>
      Promise.resolve({
        available: true,
        backend: 'decision' as const,
        verdict,
        probability: 0.9,
        model: 'jev-style',
        independence: 'independent' as const,
      }),
  } as unknown as SystemoneVerifier;
}

const notConfiguredLlm = {
  isConfigured: () => false,
} as unknown as LlmVerifier;

describe('hallucination matrix (M15.5e)', () => {
  it('reaches every deterministic failure mode', async () => {
    const modes = new Set<HallucinationFailureMode>();

    // unsupported_claim + overconfident_uncertainty
    const novel = new ClaimConsistencyService(repo([]));
    (await novel.classify({ ...ASSERTION, confidence: 0.9 })).findings.forEach(
      (f) => modes.add(f.mode),
    );

    // contradicted_claim
    const contradicted = new ClaimConsistencyService(
      repo([claim({ id: 'rival', negated: true })]),
    );
    (await contradicted.classify(ASSERTION)).findings.forEach((f) =>
      modes.add(f.mode),
    );

    // fabricated_provenance
    const fabricated = new ClaimConsistencyService(repo([]));
    (
      await fabricated.classify({ ...ASSERTION, citedClaimIds: ['ghost'] })
    ).findings.forEach((f) => modes.add(f.mode));

    // unverifiable_high_stakes (high-stakes, unresolved, no verifier)
    const verifier = new ClaimVerifierService(
      new ClaimConsistencyService(repo([])),
      fakeVerifier(false, 'unknown'),
      notConfiguredLlm,
    );
    (await verifier.verify({ ...ASSERTION, confidence: 0.9 })).findings.forEach(
      (f) => modes.add(f.mode),
    );

    const expected = HALLUCINATION_FAILURE_MODES.map((m) => m.mode).filter(
      (mode) => mode !== 'silent_self_correction',
    );
    for (const mode of expected) {
      expect(modes).toContain(mode);
    }
  });

  it('does not raise a critical finding on the benign baselines', async () => {
    // novel-but-uncontradicted: flagged (warning), never refused/critical
    const novel = new ClaimConsistencyService(repo([]));
    const result = await novel.classify(ASSERTION);
    expect(result.classification).toBe('novel');
    expect(
      result.findings.every((finding) => finding.severity !== 'critical'),
    ).toBe(true);

    // appropriately-hedged: low confidence is not overconfidence
    const hedged = await novel.classify({ ...ASSERTION, confidence: 0.3 });
    expect(hedged.findings.map((f) => f.mode)).not.toContain(
      'overconfident_uncertainty',
    );

    // supported-claim: no finding
    const supported = new ClaimConsistencyService(repo([claim()]));
    expect((await supported.classify(ASSERTION)).findings).toHaveLength(0);
  });

  it('records disagreement without rewriting the classification', async () => {
    const verifier = new ClaimVerifierService(
      new ClaimConsistencyService(repo([claim()])),
      fakeVerifier(true, 'contradicted'),
      notConfiguredLlm,
    );
    const result = await verifier.verify({ ...ASSERTION, confidence: 0.9 });
    expect(result.classification).toBe('supported');
    expect(result.disagreement).toBe(true);
  });

  it('logs every mitigation — no silent behaviour', async () => {
    const record = jest.fn(() => Promise.resolve({ id: 'm1', createdAt: 't' }));
    const ledger = {
      record,
      list: () => Promise.resolve([]),
      ping: () => Promise.resolve(),
    } as unknown as HallucinationLedgerRepository;
    const mitigation = new HallucinationMitigationService(cfg(), ledger);

    const contradicted = new ClaimConsistencyService(
      repo([claim({ id: 'rival', negated: true })]),
    );
    const plan = mitigation.plan(
      (await contradicted.classify(ASSERTION)).findings,
    );
    expect(plan.strategy).toBe('refuse');
    expect(await mitigation.record(plan)).not.toBeNull();
    expect(record).toHaveBeenCalledTimes(1);

    // A no-finding case is not a mitigation and is not logged.
    record.mockClear();
    expect(await mitigation.record(mitigation.plan([]))).toBeNull();
    expect(record).not.toHaveBeenCalled();
  });

  it('declares the benign baselines it must not fire on', () => {
    const names = HALLUCINATION_BENIGN_BASELINES.map((b) => b.name);
    expect(names).toContain('novel-but-uncontradicted');
    expect(names).toContain('recorded-disagreement');
  });
});
