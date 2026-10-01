import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { AuthService } from './auth.service';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from './cookies';

function configFor(
  dir: string,
  overrides: Partial<CoreConfig> = {},
): CoreConfig {
  return {
    authEnabled: true,
    authDirPath: dir,
    authSessionTtlMs: 60_000,
    authCookieSecure: false,
    ...overrides,
  } as CoreConfig;
}

function sessionCookieFrom(setCookies: string[], name: string): string {
  const header = setCookies.find((c) => c.startsWith(`${name}=`)) ?? '';
  return header.split(';')[0];
}

describe('AuthService', () => {
  let dir = '';
  const TOKEN = 'bootstrap-token-value';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-auth-'));
    writeFileSync(join(dir, 'token'), `${TOKEN}\n`);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('logs in with the bootstrap token and mints a verifiable session', () => {
    const service = new AuthService(configFor(dir));
    service.onModuleInit();

    const result = service.login(TOKEN, '127.0.0.1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const cookies = service.loginCookies(result.session, result.csrf);
    const sessionCookie = sessionCookieFrom(cookies, SESSION_COOKIE);
    expect(service.verify(sessionCookie)).toMatchObject({ role: 'admin' });
  });

  it('rejects a wrong token and audits the failure without values', () => {
    const service = new AuthService(configFor(dir));
    service.onModuleInit();
    expect(service.login('nope', '10.0.0.1')).toEqual({
      ok: false,
      reason: 'invalid',
    });

    const audit = readFileSync(join(dir, 'audit.log'), 'utf8');
    expect(audit).toContain('"outcome":"failure"');
    expect(audit).not.toContain('nope');
    expect(audit).not.toContain(TOKEN);
  });

  it('rate-limits repeated failures from one IP', () => {
    const service = new AuthService(configFor(dir));
    service.onModuleInit();
    for (let i = 0; i < 10; i += 1) {
      expect(service.login('wrong', '9.9.9.9')).toMatchObject({
        ok: false,
        reason: 'invalid',
      });
    }
    expect(service.login('wrong', '9.9.9.9')).toEqual({
      ok: false,
      reason: 'rate_limited',
    });
    // A different IP is unaffected.
    expect(service.login(TOKEN, '8.8.8.8').ok).toBe(true);
  });

  it('validates the double-submit CSRF pair', () => {
    const service = new AuthService(configFor(dir));
    service.onModuleInit();
    const login = service.login(TOKEN, 'ip');
    if (!login.ok) throw new Error('login failed');

    const cookieHeader = `${CSRF_COOKIE}=${login.csrf}`;
    expect(service.csrfMatches(cookieHeader, login.csrf)).toBe(true);
    expect(service.csrfMatches(cookieHeader, 'other')).toBe(false);
    expect(service.csrfMatches(cookieHeader, undefined)).toBe(false);
    expect(service.csrfMatches('', login.csrf)).toBe(false);
    expect(CSRF_HEADER).toBe('x-icos-csrf');
  });

  it('is inert when disabled', () => {
    const service = new AuthService(configFor(dir, { authEnabled: false }));
    service.onModuleInit();
    expect(service.login(TOKEN, 'ip')).toEqual({
      ok: false,
      reason: 'disabled',
    });
    expect(service.enabled).toBe(false);
    expect(service.verify(`${SESSION_COOKIE}=whatever`)).toBeNull();
  });
});
