import { TestBed } from '@angular/core/testing';
import { CoreApiService } from './core-api.service';
import { McpAdminService } from './mcp-admin.service';
import { ProviderAdminService } from './provider-admin.service';
import {
  SecretAdminService,
  SecurityStatusService,
} from './secret-admin.service';

describe('management services (S5)', () => {
  const api = {
    get: vi.fn(() => Promise.resolve({})),
    post: vi.fn(() => Promise.resolve({})),
    put: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
  };

  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockClear();
    TestBed.configureTestingModule({
      providers: [{ provide: CoreApiService, useValue: api }],
    });
  });

  it('McpAdminService hits the catalog endpoints', async () => {
    const mcp = TestBed.inject(McpAdminService);
    await mcp.upsert('files', { transport: 'stdio', command: 'npx' });
    expect(api.put).toHaveBeenCalledWith('/core/mcp/servers/files', {
      transport: 'stdio',
      command: 'npx',
    });
    await mcp.remove('files');
    expect(api.delete).toHaveBeenCalledWith('/core/mcp/servers/files');
    await mcp.catalog();
    expect(api.get).toHaveBeenCalledWith('/core/mcp/catalog');
  });

  it('ProviderAdminService selects active and tests', async () => {
    const providers = TestBed.inject(ProviderAdminService);
    await providers.setActive('conversation', 'openrouter');
    expect(api.post).toHaveBeenCalledWith('/core/providers/active', {
      role: 'conversation',
      id: 'openrouter',
    });
    await providers.test('openrouter');
    expect(api.post).toHaveBeenCalledWith(
      '/core/providers/openrouter/test',
      {},
    );
    await providers.upsert('local', { baseUrl: 'http://x/v1', model: 'm' });
    expect(api.put).toHaveBeenCalledWith('/core/providers/local', {
      baseUrl: 'http://x/v1',
      model: 'm',
    });
  });

  it('SecretAdminService writes values and reads metadata only', async () => {
    const secrets = TestBed.inject(SecretAdminService);
    await secrets.put('openrouter', 'sk-value');
    expect(api.put).toHaveBeenCalledWith('/core/secrets/openrouter', {
      value: 'sk-value',
    });
    await secrets.list();
    expect(api.get).toHaveBeenCalledWith('/core/secrets');
    await secrets.remove('openrouter');
    expect(api.delete).toHaveBeenCalledWith('/core/secrets/openrouter');
  });

  it('SecurityStatusService reads the posture', async () => {
    await TestBed.inject(SecurityStatusService).status();
    expect(api.get).toHaveBeenCalledWith('/core/security/status');
  });
});
