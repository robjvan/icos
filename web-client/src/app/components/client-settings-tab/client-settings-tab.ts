import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { SERVER_URL } from '../../../constants';
import {
  HealthService,
  MAX_HEALTH_POLL_SECONDS,
  MIN_HEALTH_POLL_SECONDS,
} from '../../services/health.service';
import { ContextService } from '../../services/context.service';
import type { ContextSettings } from '../../models/context';
import { ThemeService } from '../../services/theme.service';

/** Client settings: frontend-only prefs + the global context target. */
@Component({
  selector: 'app-client-settings-tab',
  imports: [],
  templateUrl: './client-settings-tab.html',
  styleUrl: './client-settings-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientSettingsTab implements OnInit {
  private readonly themeService = inject(ThemeService);
  private readonly healthService = inject(HealthService);
  private readonly contextApi = inject(ContextService);

  readonly theme = this.themeService.theme;
  readonly serverUrl = SERVER_URL;
  readonly themeLabel = computed(() =>
    this.theme() === 'dark' ? 'Dark (smoky granite)' : 'Light (lilac mist)',
  );

  readonly healthPollSeconds = this.healthService.pollIntervalSeconds;
  readonly minHealthPollSeconds = MIN_HEALTH_POLL_SECONDS;
  readonly maxHealthPollSeconds = MAX_HEALTH_POLL_SECONDS;

  readonly contextSettings = signal<ContextSettings | null>(null);
  readonly contextError = signal<string | null>(null);
  readonly contextBusy = signal(false);

  ngOnInit(): void {
    void this.loadContext();
  }

  setTheme(theme: 'dark' | 'light'): void {
    this.themeService.set(theme);
  }

  onHealthPollInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (input === null) {
      return;
    }
    this.healthService.setPollInterval(input.valueAsNumber);
  }

  async loadContext(): Promise<void> {
    this.contextError.set(null);
    try {
      this.contextSettings.set(await this.contextApi.settings());
    } catch (err) {
      this.contextError.set(this.message(err));
    }
  }

  async onTargetInput(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    if (input === null || Number.isNaN(input.valueAsNumber)) {
      return;
    }
    await this.saveContext({ target: input.valueAsNumber });
  }

  async toggleEnabled(): Promise<void> {
    const current = this.contextSettings();
    if (current === null) {
      return;
    }
    await this.saveContext({ enabled: !current.enabled });
  }

  private async saveContext(patch: {
    target?: number;
    enabled?: boolean;
  }): Promise<void> {
    this.contextBusy.set(true);
    this.contextError.set(null);
    try {
      this.contextSettings.set(await this.contextApi.update(patch));
    } catch (err) {
      this.contextError.set(this.message(err));
    } finally {
      this.contextBusy.set(false);
    }
  }

  private message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
