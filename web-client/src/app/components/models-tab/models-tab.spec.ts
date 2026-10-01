import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModelsTab } from './models-tab';
import { ProviderAdminService } from '../../services/provider-admin.service';

describe('ModelsTab', () => {
  const api = {
    report: vi.fn(() =>
      Promise.resolve({
        source: 'catalog' as const,
        active: { conversation: 'openrouter', memory: 'local' },
        providers: [
          {
            id: 'openrouter',
            model: 'deepseek/x',
            baseUrl: 'https://openrouter.ai/api/v1',
            enabled: true,
            hasKey: true,
          },
        ],
        errors: [],
        path: '/tmp/providers.json',
      }),
    ),
    catalog: vi.fn(() =>
      Promise.resolve([
        {
          id: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          model: 'deepseek/x',
        },
      ]),
    ),
    upsert: vi.fn(() => Promise.resolve({})),
    remove: vi.fn(() => Promise.resolve({})),
    setActive: vi.fn(() => Promise.resolve({})),
    test: vi.fn(() => Promise.resolve({ ok: true, detail: 'HTTP 200' })),
    reload: vi.fn(() => Promise.resolve({})),
  };

  let fixture: ComponentFixture<ModelsTab>;

  beforeEach(async () => {
    api.report.mockClear();
    await TestBed.configureTestingModule({
      imports: [ModelsTab],
      providers: [{ provide: ProviderAdminService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(ModelsTab);
    await fixture.componentInstance.refresh();
    fixture.detectChanges();
  });

  it('renders providers with presence and active markers', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('openrouter');
    expect(text).toContain('present');
    expect(text).toContain('conversation');
  });

  it('opens the editor form', () => {
    fixture.componentInstance.startAdd();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[formControlName="baseUrl"]'),
    ).not.toBeNull();
  });
});
