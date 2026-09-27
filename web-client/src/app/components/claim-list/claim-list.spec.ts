import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

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
  };

  beforeEach(async () => {
    claimsApi = {
      list: vi.fn().mockResolvedValue({ claims: [CLAIM] }),
      search: vi.fn().mockResolvedValue({ results: [], degraded: false }),
      detail: vi.fn().mockResolvedValue({ claim: CLAIM, evidence: [], history: [] }),
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
    expect(compiled.textContent).toContain('user prefers teal');
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
});
