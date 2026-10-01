import { appendFileSync, mkdirSync } from 'node:fs';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  parseCookies,
  serializeCookie,
  expireCookie,
} from './cookies';
import type { CookieOptions } from './cookies';
import { ensureBootstrapToken, ensureSessionKey } from './secrets-files';
import { createSession, safeEqual, verifySession } from './session';
import type { AuthRole, SessionPayload } from './session';

/** Failed logins tolerated per window before the IP is throttled. */
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export type LoginResult =
  | { ok: true; session: string; csrf: string; role: AuthRole }
  | { ok: false; reason: 'disabled' | 'invalid' | 'rate_limited' };

interface Attempt {
  count: number;
  resetAt: number;
}

/**
 * Single-user authentication (S2). One bootstrap token (owner-readable
 * file, 0600) mints a signed, httpOnly session cookie; a matching CSRF
 * cookie enables double-submit. Failed logins are rate-limited per IP
 * and every security event is appended to an audit log. No secret
 * value is ever logged.
 */
@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly attempts = new Map<string, Attempt>();
  private readonly tokenPath: string;
  private readonly keyPath: string;
  private readonly auditPath: string;
  private token = '';
  private secret: Buffer = Buffer.alloc(0);

  constructor(@Inject(CORE_CONFIG) private readonly config: CoreConfig) {
    this.tokenPath = join(config.authDirPath, 'token');
    this.keyPath = join(config.authDirPath, 'session-key');
    this.auditPath = join(config.authDirPath, 'audit.log');
  }

  onModuleInit(): void {
    if (!this.config.authEnabled) {
      this.logger.warn(
        'AUTH_ENABLED=false — the API is unauthenticated. Local/throwaway use only.',
      );
      return;
    }
    mkdirSync(this.config.authDirPath, { recursive: true, mode: 0o700 });
    const token = ensureBootstrapToken(this.tokenPath);
    const key = ensureSessionKey(this.keyPath);
    this.token = token.value;
    this.secret = Buffer.from(key.value);
    if (token.created) {
      this.logger.warn(
        `Generated bootstrap token at ${this.tokenPath} (0600). ` +
          `Use its contents to log in; it is not shown here.`,
      );
    } else {
      this.logger.log(`Authentication enabled (token: ${this.tokenPath}).`);
    }
  }

  get enabled(): boolean {
    return this.config.authEnabled;
  }

  /** Login with the bootstrap token; rate-limited per IP. */
  login(rawToken: string, ip: string): LoginResult {
    if (!this.config.authEnabled) return { ok: false, reason: 'disabled' };
    if (this.throttled(ip)) {
      this.audit('admin', 'login', { ip, outcome: 'rate_limited' });
      return { ok: false, reason: 'rate_limited' };
    }
    if (!safeEqual(rawToken, this.token)) {
      this.noteFailure(ip);
      this.audit('anonymous', 'login', { ip, outcome: 'failure' });
      return { ok: false, reason: 'invalid' };
    }
    this.attempts.delete(ip);
    const { value } = createSession(
      this.secret,
      'admin',
      this.config.authSessionTtlMs,
    );
    const csrf = randomBytes(32).toString('base64url');
    this.audit('admin', 'login', { ip, outcome: 'success' });
    return { ok: true, session: value, csrf, role: 'admin' };
  }

  /** Verify the session cookie, or null when absent/expired/tampered. */
  verify(rawCookieHeader: string | undefined): SessionPayload | null {
    if (!this.config.authEnabled) return null;
    const cookies = parseCookies(rawCookieHeader);
    return verifySession(this.secret, cookies[SESSION_COOKIE]);
  }

  /** True when the double-submit CSRF pair matches (header + cookie). */
  csrfMatches(
    rawCookieHeader: string | undefined,
    header: string | undefined,
  ): boolean {
    const cookie = parseCookies(rawCookieHeader)[CSRF_COOKIE];
    if (typeof header !== 'string' || header === '') return false;
    if (typeof cookie !== 'string' || cookie === '') return false;
    return safeEqual(header, cookie);
  }

  /** Set-Cookie headers for a successful login. */
  loginCookies(session: string, csrf: string): string[] {
    const opts = this.cookieOptions();
    return [
      serializeCookie(SESSION_COOKIE, session, opts),
      serializeCookie(CSRF_COOKIE, csrf, { ...opts, httpOnly: false }),
    ];
  }

  /** Set-Cookie headers that clear both cookies. */
  clearCookies(): string[] {
    return [expireCookie(SESSION_COOKIE), expireCookie(CSRF_COOKIE)];
  }

  recordAdminMutation(action: string, target?: string, ip?: string): void {
    this.audit('admin', action, { ...(target ? { target } : {}), ip });
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'Strict',
      secure: this.config.authCookieSecure,
      path: '/',
      maxAge: this.config.authSessionTtlMs,
    };
  }

  private throttled(ip: string): boolean {
    const attempt = this.attempts.get(ip);
    if (!attempt) return false;
    if (attempt.resetAt <= Date.now()) {
      this.attempts.delete(ip);
      return false;
    }
    return attempt.count >= LOGIN_MAX_ATTEMPTS;
  }

  private noteFailure(ip: string): void {
    const now = Date.now();
    const attempt = this.attempts.get(ip);
    if (!attempt || attempt.resetAt <= now) {
      this.attempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
      return;
    }
    attempt.count += 1;
  }

  /** Append a JSONL audit line (0600). Never contains secret values. */
  private audit(
    actor: string,
    action: string,
    extra: { target?: string; ip?: string; outcome?: string } = {},
  ): void {
    const entry = { at: new Date().toISOString(), actor, action, ...extra };
    try {
      mkdirSync(this.config.authDirPath, { recursive: true, mode: 0o700 });
      appendFileSync(this.auditPath, `${JSON.stringify(entry)}\n`, {
        mode: 0o600,
      });
    } catch {
      // Auditing must never break a request; the log line below still fires.
    }
    const detail = [
      action,
      extra.outcome ? `(${extra.outcome})` : '',
      extra.target ? `target=${extra.target}` : '',
      extra.ip ? `ip=${extra.ip}` : '',
    ]
      .filter((part) => part !== '')
      .join(' ');
    this.logger.log(`auth: ${actor} ${detail}`);
  }
}
