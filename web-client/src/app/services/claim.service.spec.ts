import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { CoreApiService } from './core-api.service';
import { ClaimService } from './claim.service';

describe('ClaimService', () => {
  it('lists with status/category/origin/limit, never kind', async () => {
    const get = vi.fn().mockResolvedValue({ claims: [] });

    await TestBed.configureTestingModule({
      providers: [ClaimService, { provide: CoreApiService, useValue: { get } }],
    }).compileComponents();

    const service = TestBed.inject(ClaimService);
    await service.list({ status: 'active', origin: 'user' });
    expect(get).toHaveBeenCalledWith('/core/claims', {
      status: 'active',
      origin: 'user',
      limit: 200,
    });
  });

  it('searches and details through the read-only endpoints', async () => {
    const get = vi.fn().mockResolvedValue({ results: [], degraded: false });

    await TestBed.configureTestingModule({
      providers: [ClaimService, { provide: CoreApiService, useValue: { get } }],
    }).compileComponents();

    const service = TestBed.inject(ClaimService);
    await service.search('teal');
    expect(get).toHaveBeenCalledWith('/core/claims/search', { q: 'teal', k: 5 });
    await service.detail('claim-1');
    expect(get).toHaveBeenCalledWith('/core/claims/claim-1');
  });
});
