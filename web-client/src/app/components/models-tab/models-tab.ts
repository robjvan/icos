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
  ProviderModel,
  ProviderReport,
  ProviderRole,
} from '../../services/provider-admin.service';
import {
  SecretAdminService,
} from '../../services/secret-admin.service';
import type { SecretMetadata } from '../../services/secret-admin.service';

/** A `$VAR` / `secret:NAME` reference (never a literal). */
function isSecretReference(value: string): boolean {
  return (
    /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(value) ||
    /^secret:[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value)
  );
}

/** Vault name for a provider's pasted key, e.g. `openrouter-key`. */
function keySecretName(id: string): string {
  const base = `${id}-key`.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 64);
  return /^[A-Za-z0-9]/.test(base) ? base : `p-${base}`.slice(0, 64);
}

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
  private readonly secretsApi = inject(SecretAdminService);

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
    contextWindow: new FormControl('', { nonNullable: true }),
    enabled: new FormControl(true, { nonNullable: true }),
  });

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.error.set(null);
    try {
      const [report, catalog, secretList] = await Promise.all([
        this.api.report(),
        this.api.catalog(),
        this.secretsApi
          .list()
          .catch(() => ({ secrets: [] as SecretMetadata[], writable: false })),
      ]);
      this.report.set(report);
      this.catalog.set(catalog);
      this.secrets.set(secretList.secrets);
      this.vaultWritable.set(secretList.writable);
      this.activeDraft.set({
        conversation: {
          provider: report.active.conversation,
          model: report.activeModel?.conversation ?? '',
        },
        memory: {
          provider: report.active.memory,
          model: report.activeModel?.memory ?? '',
        },
      });
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
      contextWindow: '',
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
      contextWindow:
        entry.contextWindow === undefined ? '' : String(entry.contextWindow),
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
    const contextWindow =
      value.contextWindow.trim() === '' ? undefined : Number(value.contextWindow);
    if (
      contextWindow !== undefined &&
      (!Number.isInteger(contextWindow) || contextWindow <= 0)
    ) {
      this.error.set('context window must be a positive integer (tokens)');
      return;
    }

    // A pasted key (not a $VAR/secret:NAME reference) goes into the vault,
    // then the provider references it — the catalog never holds a literal.
    let apiKeyRef = value.apiKeyRef.trim();
    let vaultedName: string | null = null;
    if (apiKeyRef && !isSecretReference(apiKeyRef)) {
      if (!this.vaultWritable()) {
        this.error.set(
          'the secret vault is disabled — enable it (see docs/security.md), or enter a $VAR / secret:NAME reference',
        );
        return;
      }
      const name = keySecretName(id);
      try {
        await this.secretsApi.put(name, apiKeyRef);
      } catch (err) {
        this.error.set(this.message(err));
        return;
      }
      vaultedName = name;
      apiKeyRef = `secret:${name}`;
    }

    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.upsert(id, {
        baseUrl: value.baseUrl.trim(),
        model: value.model.trim(),
        ...(apiKeyRef ? { apiKeyRef } : {}),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        ...(value.userAgent.trim() ? { userAgent: value.userAgent.trim() } : {}),
        ...(timeout !== undefined ? { timeoutMs: timeout } : {}),
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        enabled: value.enabled,
      });
      this.notice.set(
        vaultedName
          ? `Saved provider "${id}"; the key is stored in the vault as "${vaultedName}".`
          : `Saved provider "${id}".`,
      );
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

  /** Load the editor's model list from its (unsaved) endpoint (FG9c). */
  async loadEditorModels(): Promise<void> {
    const value = this.form.getRawValue();
    const baseUrl = value.baseUrl.trim();
    if (!baseUrl) {
      this.error.set('enter a base URL before loading models');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.api.probeModels(
        baseUrl,
        value.apiKeyRef.trim() || undefined,
      );
      if (!result.ok) {
        this.error.set(`load models failed: ${result.detail}`);
        return;
      }
      this.editorModels.set(result.models);
      this.notice.set(`Loaded ${result.models.length} models.`);
    } catch (err) {
      this.error.set(this.message(err));
    } finally {
      this.busy.set(false);
    }
  }

  async onActiveProvider(role: ProviderRole, event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement | null;
    const id = select?.value ?? '';
    this.activeDraft.update((map) => ({
      ...map,
      [role]: { provider: id, model: '' },
    }));
    this.activeModels.update((map) => ({ ...map, [role]: [] }));
    if (!id) return;
    try {
      const result = await this.api.models(id);
      this.activeModels.update((map) => ({ ...map, [role]: result.models }));
    } catch (err) {
      this.error.set(this.message(err));
    }
  }

  onActiveModel(role: ProviderRole, event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const model = input?.value ?? '';
    this.activeDraft.update((map) => ({
      ...map,
      [role]: { ...map[role], model },
    }));
  }

  async applyActive(role: ProviderRole): Promise<void> {
    const { provider, model } = this.activeDraft()[role];
    if (!provider) {
      this.error.set(`choose a ${role} provider first`);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      this.report.set(
        await this.api.setActive(role, provider, model || undefined),
      );
      this.notice.set(
        `Active ${role}: ${provider}${model ? ` · ${model}` : ''}.`,
      );
    } catch (err) {
      this.error.set(this.message(err));
    } finally {
      this.busy.set(false);
    }
  }

  readonly roles = ['conversation', 'memory'] as const;

  /** Vault secrets available to reference (FG9c UX). */
  readonly secrets = signal<readonly SecretMetadata[]>([]);
  readonly vaultWritable = signal(true);

  /** FG9c model pickers. */
  readonly editorModels = signal<readonly ProviderModel[]>([]);
  readonly activeModels = signal<
    Record<ProviderRole, readonly ProviderModel[]>
  >({ conversation: [], memory: [] });
  readonly activeDraft = signal<
    Record<ProviderRole, { provider: string; model: string }>
  >({
    conversation: { provider: '', model: '' },
    memory: { provider: '', model: '' },
  });

  private message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
