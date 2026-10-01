import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  SecretAdminService,
  SecurityStatusService,
} from '../../services/secret-admin.service';
import type {
  SecretMetadata,
  SecurityStatus,
} from '../../services/secret-admin.service';

/** Server settings (S5): secret vault management + exposure posture. */
@Component({
  selector: 'app-server-settings-tab',
  imports: [ReactiveFormsModule],
  templateUrl: './server-settings-tab.html',
  styleUrl: './server-settings-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServerSettingsTab implements OnInit {
  private readonly secretsApi = inject(SecretAdminService);
  private readonly securityApi = inject(SecurityStatusService);

  readonly secrets = signal<readonly SecretMetadata[]>([]);
  readonly writable = signal(false);
  readonly status = signal<SecurityStatus | null>(null);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly busy = signal(false);

  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    value: new FormControl('', { nonNullable: true }),
  });

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.error.set(null);
    try {
      const [list, status] = await Promise.all([
        this.secretsApi.list(),
        this.securityApi.status(),
      ]);
      this.secrets.set(list.secrets);
      this.writable.set(list.writable);
      this.status.set(status);
    } catch (err) {
      this.error.set(this.message(err));
    }
  }

  async save(): Promise<void> {
    const name = this.form.controls.name.value.trim();
    const value = this.form.controls.value.value;
    if (!name || value === '') {
      this.error.set('a name and value are required');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.secretsApi.put(name, value);
      // Clear the value immediately — it is never shown again.
      this.form.controls.value.reset('');
      this.form.controls.name.reset('');
      this.notice.set(`Stored "${name}". The value is not retrievable.`);
      await this.refresh();
    } catch (err) {
      this.error.set(this.message(err));
    } finally {
      this.busy.set(false);
    }
  }

  async remove(secret: SecretMetadata): Promise<void> {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Delete secret "${secret.name}"? Dependent servers/providers will fail closed.`)
    ) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.secretsApi.remove(secret.name);
      this.notice.set(`Deleted "${secret.name}".`);
      await this.refresh();
    } catch (err) {
      this.error.set(this.message(err));
    } finally {
      this.busy.set(false);
    }
  }

  private message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
