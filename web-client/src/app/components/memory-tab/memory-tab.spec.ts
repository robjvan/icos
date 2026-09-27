import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { MemoryTab } from './memory-tab';
import { MemoryCandidateService } from '../../services/memory-candidate.service';
import { MemoryReviewService } from '../../services/memory-review.service';
import { ClaimService } from '../../services/claim.service';

describe('MemoryTab', () => {
  let component: MemoryTab;
  let fixture: ComponentFixture<MemoryTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemoryTab],
      providers: [
        provideRouter([]),
        {
          provide: MemoryCandidateService,
          useValue: { candidates: () => [], error: () => null, refresh: vi.fn() },
        },
        {
          provide: MemoryReviewService,
          useValue: {
            items: () => [],
            total: () => 0,
            showResolved: () => false,
            busyId: () => null,
            runningSweep: () => false,
            error: () => null,
            lastSummary: () => null,
            pendingCount: () => 0,
            refresh: vi.fn(),
            approve: vi.fn(),
            reject: vi.fn(),
            runPromotions: vi.fn(),
            setShowResolved: vi.fn(),
          },
        },
        {
          provide: ClaimService,
          useValue: {
            list: vi.fn().mockResolvedValue({ claims: [] }),
            search: vi.fn(),
            detail: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MemoryTab);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should refresh the ledger on init', () => {
    const ledger = TestBed.inject(MemoryCandidateService);
    expect(ledger.refresh).toHaveBeenCalledWith();
  });

  it('should clear the filter and reload unfiltered', () => {
    const ledger = TestBed.inject(MemoryCandidateService) as unknown as {
      refresh: ReturnType<typeof vi.fn>;
    };
    component.filterForm.controls.sessionId.setValue('session-1');
    component.clearFilter();
    expect(component.filterForm.controls.sessionId.value).toBe('');
    expect(ledger.refresh).toHaveBeenCalledWith();
  });

  it('should default to beliefs when nothing is pending', () => {
    expect(component.view()).toBe('beliefs');
  });

  it('should expose the three segments', () => {
    expect(component.views).toEqual(['review', 'beliefs', 'ledger']);
  });
});
