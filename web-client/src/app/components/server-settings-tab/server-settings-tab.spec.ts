import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ServerSettingsTab } from './server-settings-tab';
import {
  SecretAdminService,
  SecurityStatusService,
} from '../../services/secret-admin.service';

describe('ServerSettingsTab', () => {
  const secrets = {
    list: vi.fn(() =>
      Promise.resolve({
        writable: true,
        secrets: [
          {
            name: 'openrouter',
            createdAt: 't0',
            updatedAt: 't1',
          },
        ],
      }),
    ),
    put: vi.fn(() => Promise.resolve({})),
    remove: vi.fn(() => Promise.resolve({ deleted: true })),
  };
  const security = {
    status: vi.fn(() =>
      Promise.resolve({
        host: '0.0.0.0',
        port: 3000,
        loopback: false,
        authEnabled: true,
        exposeAcknowledged: false,
        corsAllowedOrigins: ['http://localhost:4200'],
      }),
    ),
  };

  let fixture: ComponentFixture<ServerSettingsTab>;

  beforeEach(async () => {
    secrets.list.mockClear();
    await TestBed.configureTestingModule({
      imports: [ServerSettingsTab],
      providers: [
        { provide: SecretAdminService, useValue: secrets },
        { provide: SecurityStatusService, useValue: security },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ServerSettingsTab);
    await fixture.componentInstance.refresh();
    fixture.detectChanges();
  });

  it('lists secrets and shows the exposure warning when non-loopback', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('openrouter');
    expect(text).toContain('exposed beyond localhost');
  });

  it('never renders a secret value field with a stored value', () => {
    const input = (fixture.nativeElement as HTMLElement).querySelector(
      '#s-value',
    );
    expect((input as HTMLInputElement).value).toBe('');
    expect(input?.getAttribute('type')).toBe('password');
  });
});
