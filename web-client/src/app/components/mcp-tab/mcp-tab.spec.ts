import { ComponentFixture, TestBed } from '@angular/core/testing';

import { McpTab } from './mcp-tab';
import { McpAdminService } from '../../services/mcp-admin.service';

describe('McpTab', () => {
  const api = {
    servers: vi.fn(() =>
      Promise.resolve([
        {
          name: 'files',
          transport: 'stdio',
          state: 'connected',
          toolCount: 2,
        },
      ]),
    ),
    catalog: vi.fn(() =>
      Promise.resolve([{ name: 'files', transport: 'stdio' as const }]),
    ),
    upsert: vi.fn(() => Promise.resolve({})),
    remove: vi.fn(() => Promise.resolve({})),
    reload: vi.fn(() => Promise.resolve({})),
  };

  let fixture: ComponentFixture<McpTab>;

  beforeEach(async () => {
    api.servers.mockClear();
    await TestBed.configureTestingModule({
      imports: [McpTab],
      providers: [{ provide: McpAdminService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(McpTab);
    await fixture.componentInstance.refresh();
    fixture.detectChanges();
  });

  it('renders the live server list', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('files');
    expect(text).toContain('connected');
    expect(api.servers).toHaveBeenCalled();
  });

  it('opens the editor form', () => {
    const component = fixture.componentInstance;
    component.startAdd();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[formControlName="name"]'),
    ).not.toBeNull();
  });
});
