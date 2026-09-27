import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { MemoryReviewQueue } from './memory-review-queue';
import { MemoryCandidateService } from '../../services/memory-candidate.service';
import { MemoryReviewService } from '../../services/memory-review.service';

const ROW = {
  id: 'j1',
  candidateId: 'c1',
  operation: 'NEW',
  state: 'proposed',
  approvalId: 'a1',
  claimId: null,
  detail: '',
  createdAt: 't',
  updatedAt: 't',
  approvalStatus: 'pending',
};

const CANDIDATE = {
  id: 'c1',
  kind: 'fact',
  subject: 'user',
  predicate: 'prefers',
  object: 'teal',
  confidence: 0.9,
  importance: 0.7,
  stability: 0.8,
  source: { sessionId: 's1', messageId: 1 },
  extractorModel: 'm',
  extractorVersion: 'v',
  extractedAt: 't',
};

describe('MemoryReviewQueue', () => {
  let component: MemoryReviewQueue;
  let fixture: ComponentFixture<MemoryReviewQueue>;
  let review: {
    items: () => readonly unknown[];
    total: () => number;
    showResolved: () => boolean;
    busyId: () => string | null;
    runningSweep: () => boolean;
    error: () => string | null;
    lastSummary: () => null;
    pendingCount: () => number;
    refresh: ReturnType<typeof vi.fn>;
    approve: ReturnType<typeof vi.fn>;
    reject: ReturnType<typeof vi.fn>;
    runPromotions: ReturnType<typeof vi.fn>;
    setShowResolved: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    review = {
      items: () => [ROW],
      total: () => 1,
      showResolved: () => false,
      busyId: () => null,
      runningSweep: () => false,
      error: () => null,
      lastSummary: () => null,
      pendingCount: () => 1,
      refresh: vi.fn().mockResolvedValue(undefined),
      approve: vi.fn().mockResolvedValue(undefined),
      reject: vi.fn().mockResolvedValue(undefined),
      runPromotions: vi.fn().mockResolvedValue(undefined),
      setShowResolved: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [MemoryReviewQueue],
      providers: [
        { provide: MemoryReviewService, useValue: review },
        {
          provide: MemoryCandidateService,
          useValue: {
            candidates: () => [CANDIDATE],
            error: () => null,
            refresh: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MemoryReviewQueue);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the queued statement from the ledger join', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('user prefers teal');
    expect(compiled.textContent).toContain('Awaiting review');
  });

  it('should disable approve when the candidate is missing from the ledger', () => {
    component.candidateById.set(new Map());
    const missing = { ...ROW, candidateId: 'gone' };
    expect(component.canApprove(missing as never)).toBe(false);
    expect(component.statementFor(missing as never)).toBe('evidence unavailable');
  });

  it('should approve through the service, never the conversation store', async () => {
    await component.load();
    component.approve(ROW as never);
    expect(review.approve).toHaveBeenCalledWith('j1');
  });

  it('should render the failure detail verbatim', () => {
    const failed = { ...ROW, state: 'failed', detail: 'missing_candidate' };
    expect(component.stateLabel(failed as never)).toBe('Failed — missing_candidate');
  });
});
