import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';

/**
 * Global per-tool auto-approve overrides (M20f). A tool listed here runs
 * without parking for human approval even when its descriptor declares
 * `approval: 'required'`. Persisted to a small JSON file so the operator's
 * choice survives restarts.
 *
 * This is a deliberate safety relaxation: it is admin-only to change and
 * applies globally (not per session). It does **not** widen the
 * `execute_code` tool-RPC bridge, which stays limited to tools whose declared
 * approval is `none`.
 */
@Injectable()
export class ToolPrefsService {
  private readonly logger = new Logger(ToolPrefsService.name);
  private readonly path: string;
  private readonly autoApproved: Set<string>;

  constructor(@Inject(CORE_CONFIG) config: CoreConfig) {
    this.path =
      config.toolPrefsPath ?? join(homedir(), '.icos', 'tool-prefs.json');
    this.autoApproved = this.load();
  }

  isAutoApproved(name: string): boolean {
    return this.autoApproved.has(name);
  }

  /** Auto-approved tool names, alphabetical. */
  list(): string[] {
    return [...this.autoApproved].sort((a, b) => a.localeCompare(b));
  }

  /** Set the override for one tool; returns the new list. */
  setAutoApproved(name: string, value: boolean): string[] {
    if (value) {
      this.autoApproved.add(name);
    } else {
      this.autoApproved.delete(name);
    }
    this.persist();
    return this.list();
  }

  private load(): Set<string> {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as unknown;
      const list =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as { autoApprove?: unknown }).autoApprove
          : parsed;
      if (Array.isArray(list)) {
        return new Set(list.filter((n): n is string => typeof n === 'string'));
      }
    } catch {
      // Missing or unreadable → start empty.
    }
    return new Set();
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(
        tmp,
        JSON.stringify({ autoApprove: this.list() }, null, 2),
        { mode: 0o600 },
      );
      renameSync(tmp, this.path);
    } catch (err) {
      this.logger.warn(
        `Failed to persist tool prefs: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }
}
