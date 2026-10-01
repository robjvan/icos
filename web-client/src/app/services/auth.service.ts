import { Injectable, computed, inject, signal } from '@angular/core';
import {
  AUTH_LOGIN_ENDPOINT,
  AUTH_LOGOUT_ENDPOINT,
  AUTH_SESSION_ENDPOINT,
} from '../../constants';
import { CoreApiService } from './core-api.service';

interface SessionResponse {
  authenticated: boolean;
  role?: string;
}

/**
 * Client-side authentication state (S2). The server holds the truth in
 * an httpOnly cookie; this only mirrors it for the UI and gates routing.
 * `ensureChecked()` performs the session probe once and caches it.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(CoreApiService);

  private readonly state = signal<'unknown' | 'authenticated' | 'anonymous'>('unknown');
  private readonly currentRole = signal<string | null>(null);
  private pending: Promise<boolean> | null = null;

  readonly authenticated = computed(() => this.state() === 'authenticated');
  readonly checked = computed(() => this.state() !== 'unknown');
  readonly role = computed(() => this.currentRole());

  /** Probe the session once, sharing the in-flight promise. */
  ensureChecked(): Promise<boolean> {
    this.pending ??= this.refresh().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async refresh(): Promise<boolean> {
    try {
      const session = await this.api.get<SessionResponse>(AUTH_SESSION_ENDPOINT);
      this.apply(session);
      return session.authenticated;
    } catch {
      // An unreachable server is indistinguishable from "not logged in"
      // for routing purposes; both send the user to the login screen.
      this.state.set('anonymous');
      this.currentRole.set(null);
      return false;
    }
  }

  async login(token: string): Promise<void> {
    const session = await this.api.post<SessionResponse>(AUTH_LOGIN_ENDPOINT, { token });
    this.apply(session);
  }

  async logout(): Promise<void> {
    await this.api.post<SessionResponse>(AUTH_LOGOUT_ENDPOINT, {});
    this.state.set('anonymous');
    this.currentRole.set(null);
  }

  private apply(session: SessionResponse): void {
    this.state.set(session.authenticated ? 'authenticated' : 'anonymous');
    this.currentRole.set(session.role ?? null);
  }
}
