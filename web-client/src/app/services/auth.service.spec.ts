import { TestBed } from '@angular/core/testing';

import { AuthService } from './auth.service';
import { CoreApiService } from './core-api.service';

describe('AuthService', () => {
  const api = {
    get: vi.fn(),
    post: vi.fn(),
  };

  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    TestBed.configureTestingModule({
      providers: [{ provide: CoreApiService, useValue: api }],
    });
  });

  it('mirrors an authenticated session and shares the probe', async () => {
    api.get.mockResolvedValue({ authenticated: true, role: 'admin' });
    const auth = TestBed.inject(AuthService);

    const [a, b] = await Promise.all([auth.ensureChecked(), auth.ensureChecked()]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(auth.authenticated()).toBe(true);
    expect(auth.role()).toBe('admin');
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('treats an unreachable server as anonymous', async () => {
    api.get.mockRejectedValue(new Error('offline'));
    const auth = TestBed.inject(AuthService);
    expect(await auth.ensureChecked()).toBe(false);
    expect(auth.authenticated()).toBe(false);
  });

  it('logs in and out through the API', async () => {
    api.post.mockResolvedValueOnce({ authenticated: true, role: 'admin' });
    const auth = TestBed.inject(AuthService);
    await auth.login('token');
    expect(api.post).toHaveBeenCalledWith('/core/auth/login', { token: 'token' });
    expect(auth.authenticated()).toBe(true);

    api.post.mockResolvedValueOnce({ authenticated: false });
    await auth.logout();
    expect(auth.authenticated()).toBe(false);
  });
});
