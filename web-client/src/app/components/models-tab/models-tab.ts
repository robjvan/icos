import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  ProviderAdminService,
} from '../../services/provider-admin.service';
import type {
  ProviderEntry,
  ProviderReport,
  ProviderRole,
} from '../../services/provider-admin.service';

function parseRefLines(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const eq = line.indexOf('=');
    if (eq <= 0) return null;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === '' || value === '') return null;
    out[key] = value;
  }
  return out;
}

function formatRefLines(map: Record<string, string> | undefined): string {
  return Object.entries(map ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

/** LLM provider management (S5): add/edit/enable/disable/remove, active, test. */
@Component({
  selector: 'app-models-tab',
  imports: [ReactiveFormsModule],
  templateUrl: './models-tab.html',
  styleUrl: './models-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModelsTab implements OnInit {
  private readonly api = inject(ProviderAdminService);

  readonly report = signal<ProviderReport | null>(null);
  readonly catalog = signal<readonly ProviderEntry[]>([]);
  readonly testResult = signal<Record<string, string>>({});
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly busy = signal(false);
  readonly formOpen = signal(false);
  readonly editingId = signal<string | null>(null);

  readonly form = new FormGroup({
    id: new FormControl('', { nonNullable: true }),
    baseUrl: new FormControl('', { nonNullable: true }),
    model: new FormControl('', { nonNullable: true }),
    apiKeyRef: new FormControl('', { nonNullable: true }),
    headers: new FormControl('', { nonNullable: true }),
    userAgent: new FormControl('', { nonNullable: true }),
    timeoutMs: new FormControl('', { nonNullable: true }),
    enabled: new FormControl(true, { nonNullable: true }),
  });

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.error.set(null);
    try {
      const [report, catalog] = await Promise.all([
        this.api.report(),
        this.api.catalog(),
      ]);
      this.report.set(report);
      this.catalog.set(catalog);
    } catch (err) {
      this.error.set(this.message(err));
    }
  }

  async reload(): Promise<void> {
    this.busy.set(true);
    try {
      this.report.set(await this.api.reload());
      this.notice.set('Provider catalog reloaded.');
    } catch (err) {
      this.error.set(this.message(err));
    } finally {
      this.busy.set(false);
    }
  }

  async test(id: string): Promise<void> {
    this.error.set(null);
    try {
      const result = await this.api.test(id);
      this.testResult.update((map) => ({
        ...map,
        [id]: result.ok ? `ok (${result.detail})` : `failed (${result.detail})`,
      }));
    } catch (err) {
      this.testResult.update((map) => ({ ...map, [id]: this.message(err) }));
    }
  }

  async activate(role: ProviderRole, id: string): Promise<void> {
    this.error.set(null);
    try {
      this.report.set(await this.api.setActive(role, id));
      this.notice.set(`Active ${role} provider: ${id}.`);
    } catch (err) {
      this.error.set(this.message(err));
    }
  }

  startAdd(): void {
    this.editingId.set(null);
    this.form.reset({
      id: '',
      baseUrl: '',
      model: '',
      apiKeyRef: '',
      headers: '',
      userAgent: '',
      timeoutMs: '',
      enabled: true,
    });
    this.form.controls.id.enable();
    this.formOpen.set(true);
  }

  startEdit(entry: ProviderEntry): void {
    this.editingId.set(entry.id);
    this.form.reset({
      id: entry.id,
      baseUrl: entry.baseUrl,
      model: entry.model,
      apiKeyRef: entry.apiKeyRef ?? '',
      headers: formatRefLines(entry.headers),
      userAgent: entry.userAgent ?? '',
      timeoutMs: entry.timeoutMs === undefined ? '' : String(entry.timeoutMs),
      enabled: entry.enabled !== false,
    });
    this.form.controls.id.disable();
    this.formOpen.set(true);
  }

  cancel(): void {
    this.formOpen.set(false);
    this.editingId.set(null);
  }

  async submit(): Promise<void> {
    const value = this.form.getRawValue();
    const id = value.id.trim();
    if (!id || !value.baseUrl.trim() || !value.model.trim()) {
      this.error.set('id, baseUrl, and model are required');
      return;
    }
    const headers = parseRefLines(value.headers);
    if (headers === null) {
      this.error.set('header lines must be NAME=$VAR or NAME=secret:NAME');
      return;
    }
    const timeout = value.timeoutMs.trim() === '' ? undefined : Number(value.timeoutMs);
    if (timeout !== undefined && (!Number.isInteger(timeout) || timeout <= 0)) {
      this.error.set('timeout must be a positive integer (ms)');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.upsert(id, {
        baseUrl: value.baseUrl.trim(),
        model: value.model.trim(),
        ...(value.apiKeyRef.trim() ? { apiKeyRef: value.apiKeyRef.trim() } : {}),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        ...(value.userAgent.trim() ? { userAgent: value.userAgent.trim() } : {}),
        ...(timeout !== undefined ? { timeoutMs: timeout } : {}),
        enabled: value.enabled,
      });
      this.notice.set(`Saved provider "${id}".`);
      this.formOpen.set(false);
      await this.refresh();
    } catch (err) {
      this.error.set(this.message(err));
    } finally {
      this.busy.set(false);
    }
  }

  async remove(entry: ProviderEntry): Promise<void> {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Remove provider "${entry.id}"?`)
    ) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      this.report.set(await this.api.remove(entry.id));
      this.notice.set(`Removed "${entry.id}".`);
      await this.refresh();
    } catch (err) {
      this.error.set(this.message(err));
    } finally {
      this.busy.set(false);
    }
  }

  isActive(role: ProviderRole, id: string): boolean {
    return this.report()?.active[role] === id;
  }

  entryFor(id: string): ProviderEntry | undefined {
    return this.catalog().find((entry) => entry.id === id);
  }

  private message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
