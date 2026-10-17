import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { LucideMoon, LucideSun } from '@lucide/angular';
import { Router } from '@angular/router';

import { AuthService } from '../../services/auth.service';
import { HealthService, ramPercent } from '../../services/health.service';
import { RealtimeService } from '../../services/realtime.service';
import { ThemeService } from '../../services/theme.service';

export enum ServerStatus {
  ONLINE = 'Online',
  DEGRADED = 'Degraded',
  OFFLINE = 'Offline',
}

@Component({
  selector: 'app-footer-component',
  imports: [LucideMoon, LucideSun],
  templateUrl: './footer-component.html',
  styleUrl: './footer-component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FooterComponent implements OnInit, OnDestroy {
  private readonly themeService = inject(ThemeService);
  private readonly healthService = inject(HealthService);
  private readonly realtime = inject(RealtimeService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  private readonly now = signal(new Date());
  private readonly clockTimer = setInterval(() => {
    this.now.set(new Date());
  }, 1000);
  private healthTimer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    // Restart the poll when the settings slider changes the interval.
    // The effect body only manages the timer; the fetch runs async in
    // the timer callback, never as a synchronous signal write.
    effect(() => {
      this.restartHealthPoll(this.healthService.pollIntervalSeconds());
    });
  }

  readonly isDark = computed(() => this.themeService.theme() === 'dark');

  readonly currentDate = computed(() =>
    this.now().toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }),
  );

  readonly currentTime = computed(() =>
    this.now().toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }),
  );

  readonly cpuUsage = computed(() => {
    const cpu = this.healthService.health()?.host.cpuPercent;
    return cpu === null || cpu === undefined ? 'n/a' : cpu;
  });

  readonly ramUsage = computed(() => {
    const health = this.healthService.health();
    return health === null ? 'n/a' : ramPercent(health);
  });

  readonly serverStatus = computed(() => {
    if (this.healthService.error() !== null) {
      return ServerStatus.OFFLINE;
    }
    const health = this.healthService.health();
    if (health === null) {
      return ServerStatus.OFFLINE;
    }
    // A degraded roll-up (e.g. the LLM provider is unreachable) is still an
    // online core — say "Degraded", not "Offline" (FG9b).
    if (health.status !== 'healthy') {
      return ServerStatus.DEGRADED;
    }
    // REST healthy + socket live ⇒ Online; REST healthy + socket down ⇒
    // Degraded (polling fallback covers the gap, and says so).
    return this.realtime.connected() ? ServerStatus.ONLINE : ServerStatus.DEGRADED;
  });

  /** LLM provider reachability (FG9b) for the footer chip. */
  readonly llmStatus = computed(() => {
    const llm = this.healthService.health()?.runtime.llm;
    if (!llm || llm.reachable === undefined) return 'LLM ?';
    return llm.reachable ? 'LLM ok' : 'LLM down';
  });

  readonly llmStatusClass = computed(() => {
    const llm = this.healthService.health()?.runtime.llm;
    if (!llm || llm.reachable === undefined) return '';
    return llm.reachable
      ? 'text-(--badge-sage-text)'
      : 'text-(--accent-red)';
  });

  readonly serverStatusClass = computed(() => {
    // Badge-grade text colors: all pass 4.5:1 on either theme background.
    switch (this.serverStatus()) {
      case ServerStatus.OFFLINE:
        return 'text-(--accent-red)';
      case ServerStatus.DEGRADED:
        return 'text-(--badge-amber-text)';
      case ServerStatus.ONLINE:
        return 'text-(--badge-sage-text)';
    }
  });

  readonly healthTitle = computed(() => {
    const error = this.healthService.error();
    if (error !== null) {
      return `Health unavailable: ${error}`;
    }
    const health = this.healthService.health();
    if (health === null) {
      return 'Loading system health…';
    }
    const { os, arch, cpuCores } = health.host;
    const llm = health.runtime.llm;
    return `${os} · ${arch} · ${cpuCores} cores\nLLM: ${llm.provider}/${llm.model} — ${llm.detail}`;
  });

  ngOnInit(): void {
    void this.healthService.refresh();
    this.restartHealthPoll(this.healthService.pollIntervalSeconds());
  }

  ngOnDestroy(): void {
    clearInterval(this.clockTimer);
    clearInterval(this.healthTimer);
  }

  toggleTheme(): void {
    this.themeService.toggle();
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }

  private restartHealthPoll(intervalSeconds: number): void {
    clearInterval(this.healthTimer);
    // Polling is the fallback path: while the socket is connected the
    // server pushes health and zero periodic requests go out (DoD).
    // Keep the timer armed regardless — when the socket drops, the next
    // tick covers the gap within one interval (B6-tested).
    this.healthTimer = setInterval(() => {
      if (!this.realtime.connected()) {
        void this.healthService.refresh();
      }
      // Interval change while connected still re-subscribes so the
      // server-side push cadence follows the slider (D4).
      this.realtime.resubscribe();
    }, intervalSeconds * 1000);
  }
}
