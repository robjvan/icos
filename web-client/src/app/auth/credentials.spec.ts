import { mutationHeaders, csrfToken } from './credentials';

describe('auth credentials', () => {
  afterEach(() => {
    document.cookie = 'icos_csrf=; Max-Age=0; path=/';
  });

  it('returns null when the CSRF cookie is absent', () => {
    document.cookie = 'icos_csrf=; Max-Age=0; path=/';
    expect(csrfToken()).toBeNull();
    expect(mutationHeaders()).toEqual({ 'Content-Type': 'application/json' });
  });

  it('echoes the CSRF cookie in the header when present', () => {
    document.cookie = 'icos_csrf=abc123; path=/';
    expect(csrfToken()).toBe('abc123');
    expect(mutationHeaders()).toEqual({
      'Content-Type': 'application/json',
      'x-icos-csrf': 'abc123',
    });
  });
});
