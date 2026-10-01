/**
 * Boot-time security posture (S1). Pure and testable: it decides what
 * to tell the operator about where the process is reachable and whether
 * that is safe, without touching the network or the logger.
 *
 * ICOS has no authentication yet (that is the next slice), so binding
 * beyond loopback is genuine exposure and must say so loudly.
 */

export interface SecurityPostureInput {
  host: string;
  port: number;
  /** Browser origins allowed to call the API (already validated). */
  corsAllowedOrigins: readonly string[];
  /** Operator asserts exposure is deliberate and protected. */
  exposeAcknowledged: boolean;
  /** Are we inside a container? (Exposure boundary is the port map.) */
  inContainer: boolean;
}

export interface SecurityNotice {
  level: 'info' | 'warn';
  /** Single logical line (may contain a leading marker for emphasis). */
  message: string;
}

export interface SecurityPosture {
  host: string;
  port: number;
  loopback: boolean;
  notices: SecurityNotice[];
}

/** True for loopback names/addresses we bind (and can bind) directly. */
export function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  if (value === 'localhost' || value === '::1' || value === '[::1]')
    return true;
  if (value.startsWith('127.')) return true;
  return false;
}

/** Best-effort container detection (Docker/Podman drop these markers). */
export function isRunningInContainer(
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = () => false,
): boolean {
  if (env['container'] !== undefined) return true;
  return fileExists('/.dockerenv');
}

/**
 * Describe the posture. Loopback is quiet; anything reachable beyond
 * this machine warns until the operator acknowledges it.
 */
export function assessPosture(input: SecurityPostureInput): SecurityPosture {
  const loopback = isLoopbackHost(input.host);
  const notices: SecurityNotice[] = [];
  const origins =
    input.corsAllowedOrigins.length > 0
      ? input.corsAllowedOrigins.join(', ')
      : 'none (same-origin only)';

  notices.push({
    level: 'info',
    message: `Listening on ${input.host}:${input.port}; cross-origin callers allowed: ${origins}.`,
  });

  if (loopback) {
    notices.push({
      level: 'info',
      message: 'Bound to loopback: reachable only from this machine.',
    });
    return { host: input.host, port: input.port, loopback, notices };
  }

  if (input.exposeAcknowledged) {
    notices.push({
      level: 'info',
      message:
        'Exposed beyond loopback (EXPOSE_ACKNOWLEDGED=true). Ensure TLS and authentication are in front of it.',
    });
    return { host: input.host, port: input.port, loopback, notices };
  }

  const boundary = input.inContainer
    ? 'Inside a container the boundary is the published port: publish to 127.0.0.1 unless you mean to expose it.'
    : 'This is a plain off-loopback bind.';
  notices.push({
    level: 'warn',
    message: `EXPOSED: bound to ${input.host}:${input.port}, reachable beyond this machine.`,
  });
  notices.push({
    level: 'warn',
    message:
      'ICOS has no authentication yet — anyone who can reach this port can read your conversations and spend your LLM credits.',
  });
  notices.push({ level: 'warn', message: boundary });
  notices.push({
    level: 'warn',
    message:
      'Put it behind TLS + authentication (reverse proxy / VPN), or set HOST=127.0.0.1. ' +
      'Set EXPOSE_ACKNOWLEDGED=true only once protected.',
  });

  return { host: input.host, port: input.port, loopback, notices };
}
