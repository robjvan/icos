import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaimList } from './claim-list';
import { ClaimService } from '../../services/claim.service';

const CLAIM = {
  id: 'claim-1',
  subject: 'user',
  predicate: 'prefers',
  object: 'teal',
  category: 'preference',
  status: 'active',
  extractorConfidence: 0.9,
  confidence: 0.9,
  firstAssertedAt: 'c1',
  lastSurfacedAt: 'c1',
  origin: 'user',
  evidence: [],
  entities: [],
  promotion: 'approved:a1',
};

describe('ClaimList', () => {
  let component: ClaimList;
  let fixture: ComponentFixture<ClaimList>;
  let claimsApi: {
    list: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    detail: ReturnType<typeof vi.fn>;
    listCommittedContradictions: ReturnType<typeof vi.fn>;
    listProspective: ReturnType<typeof vi.fn>;
    revision: ReturnType<typeof signal<number>>;
    notifyUpdated: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    claimsApi = {
      list: vi.fn().mockResolvedValue({ claims: [CLAIM] }),
      search: vi.fn().mockResolvedValue({ results: [], degraded: false }),
      detail: vi.fn().mockResolvedValue({ claim: CLAIM, evidence: [], history: [] }),
      listCommittedContradictions: vi.fn().mockResolvedValue([]),
      listProspective: vi.fn().mockResolvedValue({ items: [] }),
      revision: signal(0),
      notifyUpdated: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ClaimList],
      providers: [{ provide: ClaimService, useValue: claimsApi }],
    }).compileComponents();

    fixture = TestBed.createComponent(ClaimList);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render claims with icon+label status', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('user prefers "teal"');
    expect(compiled.querySelector('svg')).not.toBeNull();
  });

  it('should skip search on blank queries', async () => {
    component.searchForm.controls.query.setValue('   ');
    await component.search();
    expect(claimsApi.search).not.toHaveBeenCalled();
  });

  it('should surface degraded search honestly', async () => {
    claimsApi.search.mockResolvedValue({
      results: [],
      degraded: true,
      reason: 'index down',
    });
    component.searchForm.controls.query.setValue('teal');
    await component.search();
    expect(component.degraded()).toBe('index down');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('degraded');
  });

  it('should open claim detail with evidence and history', async () => {
    await component.openClaim('claim-1');
    expect(component.selected()?.id).toBe('claim-1');
    expect(claimsApi.detail).toHaveBeenCalledWith('claim-1');
  });

  it('should reload the list when a push bumps the revision', async () => {
    const calls = claimsApi.list.mock.calls.length;
    claimsApi.revision.set(1);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(claimsApi.list.mock.calls.length).toBeGreaterThan(calls);
  });

  it('should render contradicted-by cues with counterpart links', async () => {
    const loser = { ...CLAIM, id: 'loser-1', status: 'contradicted', object: 'teal' };
    const winner = { ...CLAIM, id: 'winner-1', object: 'oak' };
    claimsApi.list.mockResolvedValue({ claims: [loser, winner] });
    claimsApi.listCommittedContradictions.mockResolvedValue([
      {
        id: 'j1',
        candidateId: 'c9',
        operation: 'CONTRADICT',
        state: 'committed',
        approvalId: 'a9',
        claimId: 'winner-1',
        detail: 'contradicts:loser-1',
        createdAt: 't',
        updatedAt: 't',
      },
    ]);
    await component.load();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('contradicted by');
    expect(compiled.textContent).toContain('oak');
    const link = compiled.querySelector('.pair button.link');
    expect(link).not.toBeNull();
  });

  it('should render the negation marker on negated rows', async () => {
    claimsApi.list.mockResolvedValue({
      claims: [{ ...CLAIM, object: 'teal', negated: true }],
    });
    await component.load();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('not "teal"');
  });

  it('should show the pair and parked question in detail', async () => {
    const loser = { ...CLAIM, id: 'loser-1', status: 'contradicted', object: 'teal' };
    const winner = { ...CLAIM, id: 'winner-1', object: 'oak' };
    claimsApi.list.mockResolvedValue({ claims: [loser, winner] });
    claimsApi.detail.mockResolvedValue({ claim: loser, evidence: [], history: [] });
    claimsApi.listCommittedContradictions.mockResolvedValue([
      {
        id: 'j1',
        candidateId: 'c9',
        operation: 'CONTRADICT',
        state: 'committed',
        approvalId: 'a9',
        claimId: 'winner-1',
        detail: 'contradicts:loser-1',
        createdAt: 't',
        updatedAt: 't',
      },
    ]);
    claimsApi.listProspective.mockResolvedValue({
      items: [
        {
          id: 'p1',
          subject: 'user',
          predicate: 'prefers',
          options: [
            { object: 'oak', origin: 'user', confidence: 0.9, claimId: 'winner-1' },
            { object: 'teal', origin: 'user', confidence: 0.9, claimId: 'loser-1' },
          ],
          contestCount: 2,
          trigger: 'repeated_contest',
          suggestedQuestion: 'Which should be kept, oak or teal?',
          status: 'open',
          createdAt: 't',
          updatedAt: 't',
        },
      ],
    });
    await component.load();
    await component.openClaim('loser-1');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Contradicted by');
    expect(compiled.textContent).toContain('Which should be kept, oak or teal?');
  });

  it('should leave unpaired rows when pairing inputs fail', async () => {
    claimsApi.listCommittedContradictions.mockRejectedValue(new Error('down'));
    claimsApi.listProspective.mockRejectedValue(new Error('down'));
    await component.load();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('user prefers "teal"');
    expect(compiled.querySelector('.pair')).toBeNull();
  });
});
