import { expireCookie, parseCookies, serializeCookie } from './cookies';

describe('serializeCookie', () => {
  it('builds an httpOnly SameSite=Strict Secure cookie', () => {
    expect(
      serializeCookie('icos_session', 'abc', {
        httpOnly: true,
        sameSite: 'Strict',
        secure: true,
        path: '/',
        maxAge: 60_000,
      }),
    ).toBe(
      'icos_session=abc; Path=/; Max-Age=60; SameSite=Strict; HttpOnly; Secure',
    );
  });

  it('omits HttpOnly when asked (CSRF cookie)', () => {
    const value = serializeCookie('icos_csrf', 'xyz', {
      httpOnly: false,
      sameSite: 'Strict',
      secure: false,
      path: '/',
    });
    expect(value).not.toContain('HttpOnly');
    expect(value).not.toContain('Secure');
    expect(value).toContain('SameSite=Strict');
  });

  it('expires a cookie immediately', () => {
    expect(expireCookie('icos_session')).toContain('Max-Age=0');
  });
});

describe('parseCookies', () => {
  it('parses a cookie header, tolerating whitespace and junk', () => {
    expect(parseCookies('a=1; b=two; broken; c=3')).toEqual({
      a: '1',
      b: 'two',
      c: '3',
    });
  });

  it('returns empty for absent or blank headers', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('   ')).toEqual({});
  });
});
