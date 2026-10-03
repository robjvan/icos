import type { Claim } from '../memory/claim';
import { identityKey } from '../memory/claim-identity';
import type { ClaimRepository } from '../memory/claim.repository';
import { ClaimConsistencyService } from './claim-consistency.service';

function makeClaim(overrides: Partial<Claim> = {}): Claim {
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

function fakeRepo(claims: Claim[]): ClaimRepository {
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const byTriple = new Map(
    claims.map((claim) => [
      `${identityKey(claim)}|${claim.negated ? 1 : 0}`,
      claim,
    ]),
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

const ASSERTION = { subject: 'user', predicate: 'prefers', object: 'oak' };

describe('ClaimConsistencyService (M15.5b)', () => {
  it('classifies a supported assertion with no finding', async () => {
    const service = new ClaimConsistencyService(fakeRepo([makeClaim()]));
    const result = await service.classify(ASSERTION);
    expect(result.classification).toBe('supported');
    expect(result.supportingClaimId).toBe('claim-1');
    expect(result.findings).toHaveLength(0);
  });

  it('classifies a novel assertion as unsupported — flagged, not refused', async () => {
    const service = new ClaimConsistencyService(fakeRepo([]));
    const result = await service.classify(ASSERTION);
    expect(result.classification).toBe('novel');
    expect(result.findings).toEqual([
      expect.objectContaining({
        mode: 'unsupported_claim',
        severity: 'warning',
      }),
    ]);
  });

  it('flags overconfidence when a novel assertion is asserted at high confidence', async () => {
    const service = new ClaimConsistencyService(fakeRepo([]));
    const result = await service.classify({ ...ASSERTION, confidence: 0.9 });
    expect(result.findings.map((finding) => finding.mode)).toEqual([
      'unsupported_claim',
      'overconfident_uncertainty',
    ]);
  });

  it('classifies an opposing active claim as contradicted', async () => {
    const service = new ClaimConsistencyService(
      fakeRepo([makeClaim({ id: 'rival', negated: true, confidence: 0.9 })]),
    );
    const result = await service.classify(ASSERTION);
    expect(result.classification).toBe('contradicted');
    expect(result.contradictingClaimId).toBe('rival');
    expect(result.findings).toEqual([
      expect.objectContaining({
        mode: 'contradicted_claim',
        severity: 'critical',
      }),
    ]);
  });

  it('does not treat weak or non-active claims as support', async () => {
    const weak = new ClaimConsistencyService(
      fakeRepo([makeClaim({ confidence: 0.3 })]),
    );
    expect((await weak.classify(ASSERTION)).classification).toBe('novel');

    const retired = new ClaimConsistencyService(
      fakeRepo([makeClaim({ status: 'retired' })]),
    );
    expect((await retired.classify(ASSERTION)).classification).toBe('novel');
  });

  it('catches fabricated provenance even when the claim is otherwise supported', async () => {
    const service = new ClaimConsistencyService(fakeRepo([makeClaim()]));
    const result = await service.classify({
      ...ASSERTION,
      citedClaimIds: ['claim-1', 'ghost'],
    });
    expect(result.classification).toBe('supported');
    expect(result.fabricatedClaimIds).toEqual(['ghost']);
    expect(result.findings).toEqual([
      expect.objectContaining({
        mode: 'fabricated_provenance',
        severity: 'critical',
      }),
    ]);
  });
});
