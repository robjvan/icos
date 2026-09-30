import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { MemoryReviewService } from './memory-review.service';
import { CoreApiService } from './core-api.service';

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

describe('MemoryReviewService', () => {
  it('fetches the open queue by default and tracks the pending count', async () => {
    const get = vi.fn().mockResolvedValue({ promotions: [ROW], total: 1 });

    await TestBed.configureTestingModule({
      providers: [MemoryReviewService, { provide: CoreApiService, useValue: { get } }],
    }).compileComponents();

    const service = TestBed.inject(MemoryReviewService);
    await service.refresh();
    expect(get).toHaveBeenCalledWith('/core/promotions', {
      state: 'proposed,promoting',
      limit: 200,
    });
    expect(service.items()).toHaveLength(1);
    expect(service.total()).toBe(1);
    expect(service.pendingCount()).toBe(1);
    expect(service.error()).toBeNull();
  });

  it('fetches all states when resolved items are shown', async () => {
    const get = vi.fn().mockResolvedValue({ promotions: [], total: 0 });

    await TestBed.configureTestingModule({
      providers: [MemoryReviewService, { provide: CoreApiService, useValue: { get } }],
    }).compileComponents();

    const service = TestBed.inject(MemoryReviewService);
    service.setShowResolved(true);
    await service.refresh();
    expect(get).toHaveBeenCalledWith('/core/promotions', {
      state: 'proposed,promoting,committed,denied,failed',
      limit: 200,
    });
  });

  it('approves then runs the sweep then refreshes, in order', async () => {
    const calls: string[] = [];
    const get = vi.fn((endpoint: string) => {
      calls.push(`GET ${endpoint}`);
      if (endpoint === '/core/promotions') {
        return Promise.resolve({ promotions: [ROW], total: 1 });
      }
      return Promise.resolve({ id: 'a1', sessionId: 's1', status: 'pending' });
    });
    const post = vi.fn((endpoint: string) => {
      calls.push(`POST ${endpoint}`);
      return Promise.resolve({ summary: { new: 1, reinforced: 0, contradicted: 0, denied: 0, failed: 0, skipped: 0 } });
    });

    await TestBed.configureTestingModule({
      providers: [
        MemoryReviewService,
        { provide: CoreApiService, useValue: { get, post } },
      ],
    }).compileComponents();

    const service = TestBed.inject(MemoryReviewService);
    await service.refresh();
    calls.length = 0;
    await service.approve('j1');
    expect(calls).toEqual([
      'GET /core/approvals/a1',
      'POST /core/approvals/a1/approve',
      'POST /core/promotions/run',
      'GET /core/promotions',
    ]);
    expect(service.busyId()).toBeNull();
    expect(service.lastSummary()).toMatchObject({ new: 1 });
  });

  it('rejects with the owning session and refreshes', async () => {
    const get = vi.fn((endpoint: string) => {
      if (endpoint === '/core/promotions') {
        return Promise.resolve({ promotions: [ROW], total: 1 });
      }
      return Promise.resolve({ id: 'a1', sessionId: 's1', status: 'pending' });
    });
    const post = vi.fn().mockResolvedValue({});

    await TestBed.configureTestingModule({
      providers: [
        MemoryReviewService,
        { provide: CoreApiService, useValue: { get, post } },
      ],
    }).compileComponents();

    const service = TestBed.inject(MemoryReviewService);
    await service.refresh();
    await service.reject('j1');
    expect(post).toHaveBeenCalledWith('/core/approvals/a1/reject', { sessionId: 's1' });
    expect(service.error()).toBeNull();
  });

  it('treats a 409 resolution race as success-ish, not an error', async () => {
    const get = vi.fn((endpoint: string) => {
      if (endpoint === '/core/promotions') {
        return Promise.resolve({ promotions: [], total: 0 });
      }
      return Promise.resolve({ id: 'a1', sessionId: 's1', status: 'approved' });
    });
    const post = vi.fn().mockRejectedValue(new Error('POST failed: 409 Conflict'));

    await TestBed.configureTestingModule({
      providers: [
        MemoryReviewService,
        { provide: CoreApiService, useValue: { get, post } },
      ],
    }).compileComponents();

    const service = TestBed.inject(MemoryReviewService);
    await service.refresh();
    // Seed one pending row directly (refresh returned empty after resolve).
    service.items.set([ROW] as never);
    await service.reject('j1');
    expect(service.error()).toBeNull();
  });

  it('leaves state untouched on failure and surfaces the error', async () => {
    const get = vi.fn().mockRejectedValue(new Error('offline'));

    await TestBed.configureTestingModule({
      providers: [MemoryReviewService, { provide: CoreApiService, useValue: { get } }],
    }).compileComponents();

    const service = TestBed.inject(MemoryReviewService);
    await service.refresh();
    expect(service.items()).toEqual([]);
    expect(service.error()).toBe('offline');
  });
});
