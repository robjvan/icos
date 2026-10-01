import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  McpAdminService,
} from '../../services/mcp-admin.service';
import type {
  McpServerEntry,
  McpServerStatus,
} from '../../services/mcp-admin.service';

/** Parse `KEY=reference` lines; null when a line is malformed. */
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

/** MCP server management (S5): add/edit/enable/disable/remove + reload. */
@Component({
  selector: 'app-mcp-tab',
  imports: [ReactiveFormsModule],
  templateUrl: './mcp-tab.html',
  styleUrl: './mcp-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class McpTab implements OnInit {
  private readonly api = inject(McpAdminService);

  readonly servers = signal<readonly McpServerStatus[]>([]);
  readonly catalog = signal<readonly McpServerEntry[]>([]);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly busy = signal(false);
  readonly formOpen = signal(false);
  readonly editingName = signal<string | null>(null);

  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    transport: new FormControl<'stdio' | 'http'>('stdio', { nonNullable: true }),
    command: new FormControl('', { nonNullable: true }),
    args: new FormControl('', { nonNullable: true }),
    url: new FormControl('', { nonNullable: true }),
    env: new FormControl('', { nonNullable: true }),
    headers: new FormControl('', { nonNullable: true }),
    approval: new FormControl<'required' | 'none'>('required', {
      nonNullable: true,
    }),
    enabled: new FormControl(true, { nonNullable: true }),
  });

  readonly isStdio = computed(() => this.form.controls.transport.value === 'stdio');

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.error.set(null);
    try {
      const [servers, catalog] = await Promise.all([
        this.api.servers(),
        this.api.catalog(),
      ]);
      this.servers.set(servers);
      this.catalog.set(catalog);
    } catch (err) {
      this.error.set(this.message(err));
    }
  }

  async reload(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const report = await this.api.reload();
      this.notice.set(
        report.enabled
          ? `Reloaded: ${report.servers.map((s) => `${s.name}=${s.state}`).join(', ') || 'no servers'}`
          : 'MCP is disabled (MCP_ENABLED=false).',
      );
      await this.refresh();
    } catch (err) {
      this.error.set(this.message(err));
    } finally {
      this.busy.set(false);
    }
  }

  startAdd(): void {
    this.editingName.set(null);
    this.form.reset({
      name: '',
      transport: 'stdio',
      command: '',
      args: '',
      url: '',
      env: '',
      headers: '',
      approval: 'required',
      enabled: true,
    });
    this.form.controls.name.enable();
    this.formOpen.set(true);
  }

  startEdit(entry: McpServerEntry): void {
    this.editingName.set(entry.name);
    this.form.reset({
      name: entry.name,
      transport: entry.transport,
      command: entry.command ?? '',
      args: (entry.args ?? []).join(' '),
      url: entry.url ?? '',
      env: formatRefLines(entry.env),
      headers: formatRefLines(entry.headers),
      approval: entry.approval ?? 'required',
      enabled: entry.enabled !== false,
    });
    this.form.controls.name.disable();
    this.formOpen.set(true);
  }

  cancel(): void {
    this.formOpen.set(false);
    this.editingName.set(null);
  }

  async submit(): Promise<void> {
    const value = this.form.getRawValue();
    const name = value.name.trim();
    if (!name) {
      this.error.set('a server name is required');
      return;
    }
    const env = parseRefLines(value.env);
    const headers = parseRefLines(value.headers);
    if (env === null || headers === null) {
      this.error.set('env/header lines must be KEY=$VAR or KEY=secret:NAME');
      return;
    }
    const input = {
      transport: value.transport,
      ...(value.transport === 'stdio'
        ? {
            command: value.command.trim(),
            args: value.args.trim() === '' ? [] : value.args.trim().split(/\s+/),
          }
        : { url: value.url.trim() }),
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      approval: value.approval,
      enabled: value.enabled,
    };
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.upsert(name, input);
      this.notice.set(`Saved "${name}".`);
      this.formOpen.set(false);
      await this.refresh();
    } catch (err) {
      this.error.set(this.message(err));
    } finally {
      this.busy.set(false);
    }
  }

  async remove(entry: McpServerEntry): Promise<void> {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Remove MCP server "${entry.name}"?`)
    ) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.remove(entry.name);
      this.notice.set(`Removed "${entry.name}".`);
      await this.refresh();
    } catch (err) {
      this.error.set(this.message(err));
    } finally {
      this.busy.set(false);
    }
  }

  entryFor(name: string): McpServerEntry | undefined {
    return this.catalog().find((entry) => entry.name === name);
  }

  stateClass(state: McpServerStatus['state']): string {
    switch (state) {
      case 'connected':
        return 'text-(--badge-sage-text)';
      case 'failed':
        return 'text-(--accent-red)';
      default:
        return 'text-(--text-secondary)';
    }
  }

  private message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
