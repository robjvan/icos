import { createSession, safeEqual, verifySession } from './session';

const SECRET = Buffer.from('test-secret-key-0123456789abcdef');

describe('safeEqual', () => {
  it('compares in constant time and rejects length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('session tokens', () => {
  it('round-trips a valid session', () => {
    const { value, payload } = createSession(SECRET, 'admin', 1000, 1_000);
    expect(verifySession(SECRET, value, 1_500)).toEqual(payload);
    expect(payload.role).toBe('admin');
  });

  it('rejects expiry, tampering, and malformed input', () => {
    const { value } = createSession(SECRET, 'user', 1000, 1_000);
    expect(verifySession(SECRET, value, 2_001)).toBeNull();

    const [data, sig] = value.split('.');
    expect(verifySession(SECRET, `${data}.${sig}x`, 1_000)).toBeNull();
    expect(verifySession(SECRET, `${data}.`, 1_000)).toBeNull();
    expect(verifySession(SECRET, 'nodot', 1_000)).toBeNull();
    expect(verifySession(SECRET, undefined, 1_000)).toBeNull();
    expect(
      verifySession(Buffer.from('different-key'), value, 1_000),
    ).toBeNull();
  });

  it('rejects a payload with an unknown role', () => {
    const forged = Buffer.from(
      JSON.stringify({ sub: 'admin', role: 'root', iat: 0, exp: 9_999 }),
    ).toString('base64url');
    const token = `${forged}.${''}`;
    expect(verifySession(SECRET, token, 1_000)).toBeNull();
  });
});
