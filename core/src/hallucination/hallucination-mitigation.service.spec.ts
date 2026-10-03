import type { CoreConfig } from '../config';
import type { MitigationPosture } from './hallucination-modes';
import { HallucinationLedgerRepository } from './hallucination-ledger.repository';
import { HallucinationMitigationService } from './hallucination-mitigation.service';
import type { ClaimFinding } from './hallucination.types';

function cfg(posture?: Partial<MitigationPosture>): CoreConfig {
  return { hallucinationMitigationPosture: posture } as unknown as CoreConfig;
}

function ledger() {
  const record = jest.fn((input: RecordMitigationInputShape) =>
    Promise.resolve({
      id: 'm1',
      createdAt: 't',
      mode: input.mode ?? null,
      subject: input.subject ?? null,
      ...input,
    }),
  );
  return {
    repository: {
      record,
      list: () => Promise.resolve([]),
      ping: () => Promise.resolve(),
    } as unknown as HallucinationLedgerRepository,
    record,
  };
}

interface RecordMitigationInputShape {
  severity: string;
  strategy: string;
  mode?: string | null;
  reason: string;
  subject?: string | null;
}

function finding(overrides: Partial<ClaimFinding> = {}): ClaimFinding {
  return {
    mode: 'unsupported_claim',
    severity: 'warning',
    reason: 'a reason',
    ...overrides,
  };
}

describe('HallucinationMitigationService (M15.5d)', () => {
  it('does nothing with no findings', () => {
    const service = new HallucinationMitigationService(
      cfg(),
      ledger().repository,
    );
    expect(service.plan([])).toMatchObject({ strategy: 'none', trigger: null });
  });

  it('refuses a critical finding by default', () => {
    const service = new HallucinationMitigationService(
      cfg(),
      ledger().repository,
    );
    const plan = service.plan([
      finding({ severity: 'critical', mode: 'contradicted_claim' }),
    ]);
    expect(plan.strategy).toBe('refuse');
    expect(plan.trigger?.severity).toBe('critical');
  });

  it('flags watch and warning findings by default', () => {
    const service = new HallucinationMitigationService(
      cfg(),
      ledger().repository,
    );
    expect(service.plan([finding({ severity: 'watch' })]).strategy).toBe(
      'flag',
    );
    expect(service.plan([finding({ severity: 'warning' })]).strategy).toBe(
      'flag',
    );
  });

  it('takes the strictest strategy across findings', () => {
    const service = new HallucinationMitigationService(
      cfg(),
      ledger().repository,
    );
    const plan = service.plan([
      finding({ severity: 'watch' }),
      finding({ severity: 'critical', mode: 'contradicted_claim' }),
    ]);
    expect(plan.strategy).toBe('refuse');
    expect(plan.trigger?.mode).toBe('contradicted_claim');
  });

  it('honours a posture override', () => {
    const service = new HallucinationMitigationService(
      cfg({ warning: 're_ground' }),
      ledger().repository,
    );
    expect(service.plan([finding({ severity: 'warning' })]).strategy).toBe(
      're_ground',
    );
    // Unspecified severities keep their defaults.
    expect(service.plan([finding({ severity: 'critical' })]).strategy).toBe(
      'refuse',
    );
  });

  it('records non-none mitigations with the finding, and skips none', async () => {
    const { repository, record } = ledger();
    const service = new HallucinationMitigationService(cfg(), repository);

    const logged = await service.record(
      service.plan([
        finding({ severity: 'critical', mode: 'contradicted_claim' }),
      ]),
      { subject: 'user prefers oak', detail: { candidateId: 'c1' } },
    );
    expect(logged).not.toBeNull();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: 'refuse',
        severity: 'critical',
        subject: 'user prefers oak',
      }),
    );

    record.mockClear();
    expect(await service.record(service.plan([]))).toBeNull();
    expect(record).not.toHaveBeenCalled();
  });
});
