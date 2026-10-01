import {
  assessPosture,
  isLoopbackHost,
  isRunningInContainer,
} from './security-posture';

describe('isLoopbackHost', () => {
  it('accepts loopback names and 127.x addresses', () => {
    for (const host of [
      'localhost',
      '127.0.0.1',
      '127.1.2.3',
      '::1',
      '[::1]',
    ]) {
      expect(isLoopbackHost(host)).toBe(true);
    }
  });

  it('rejects anything reachable beyond the machine', () => {
    for (const host of ['0.0.0.0', '192.168.2.10', 'example.com', '::']) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });
});

describe('isRunningInContainer', () => {
  it('detects Docker/Podman markers', () => {
    expect(isRunningInContainer({ container: 'docker' }, () => false)).toBe(
      true,
    );
    expect(isRunningInContainer({}, (p) => p === '/.dockerenv')).toBe(true);
    expect(isRunningInContainer({}, () => false)).toBe(false);
  });
});

describe('assessPosture', () => {
  const base = {
    port: 3000,
    corsAllowedOrigins: ['http://localhost:4200'],
    exposeAcknowledged: false,
    authEnabled: true,
    inContainer: false,
  };

  it('is quiet on loopback', () => {
    const posture = assessPosture({ ...base, host: '127.0.0.1' });
    expect(posture.loopback).toBe(true);
    expect(posture.notices.every((n) => n.level === 'info')).toBe(true);
    expect(posture.notices.some((n) => n.message.includes('loopback'))).toBe(
      true,
    );
  });

  it('warns about TLS (not auth) when exposed with auth on', () => {
    const posture = assessPosture({ ...base, host: '0.0.0.0' });
    expect(posture.loopback).toBe(false);
    const text = posture.notices
      .filter((n) => n.level === 'warn')
      .map((n) => n.message)
      .join(' ');
    expect(text).toContain('EXPOSED');
    expect(text).toContain('HTTPS');
    expect(text).not.toContain('AUTH_ENABLED=false');
  });

  it('warns hard when exposed with auth off', () => {
    const posture = assessPosture({
      ...base,
      host: '0.0.0.0',
      authEnabled: false,
    });
    const text = posture.notices
      .filter((n) => n.level === 'warn')
      .map((n) => n.message)
      .join(' ');
    expect(text).toContain('AUTH_ENABLED=false');
  });

  it('notes the container port-mapping boundary', () => {
    const posture = assessPosture({
      ...base,
      host: '0.0.0.0',
      inContainer: true,
    });
    expect(
      posture.notices.some((n) => n.message.includes('published port')),
    ).toBe(true);
  });

  it('goes quiet once exposure is acknowledged', () => {
    const posture = assessPosture({
      ...base,
      host: '0.0.0.0',
      exposeAcknowledged: true,
    });
    expect(posture.notices.every((n) => n.level === 'info')).toBe(true);
    expect(
      posture.notices.some((n) => n.message.includes('ACKNOWLEDGED')),
    ).toBe(true);
  });

  it('reports the allowed origins in the info line', () => {
    const none = assessPosture({
      ...base,
      host: '127.0.0.1',
      corsAllowedOrigins: [],
    });
    expect(none.notices[0].message).toContain('same-origin only');
  });
});
