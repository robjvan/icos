import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { parsePersonaCore } from './persona-core';
import { PersonaRepository } from './persona.repository';
import {
  DEFAULT_PERSONA_USER_ID,
  type PersonaCoreEntry,
  type PersonaCoreStatus,
} from './persona.types';

/**
 * Loads and serves the immutable core persona (M14b).
 *
 * The core is a read-only file. This service **reads** it at boot,
 * hashes it, parses it, and records the hash for change detection. It
 * has no write path: there is no method, no API, and no store call that
 * mutates the core file or its entries. A hash change between boots is a
 * human edit and is recorded as an `info`-severity audit entry
 * (`persona_core_changed`), explicitly not a drift finding.
 *
 * A missing or invalid core is a **loud degraded boot** — the status is
 * `loaded: false` with a reason, and grounding is expected to cap its
 * score. Identity is never fabricated.
 */
@Injectable()
export class PersonaCoreService implements OnModuleInit {
  private readonly logger = new Logger(PersonaCoreService.name);
  private readonly path: string;
  private readonly required: boolean;
  private snapshot: {
    loaded: boolean;
    hash: string | null;
    entries: readonly PersonaCoreEntry[];
    evaluatedAt: string;
    reason?: string;
    changedSinceLastLoad: boolean;
  } = {
    loaded: false,
    hash: null,
    entries: [],
    evaluatedAt: new Date(0).toISOString(),
    reason: 'core persona has not been loaded yet',
    changedSinceLastLoad: false,
  };

  constructor(
    @Inject(CORE_CONFIG) config: CoreConfig,
    private readonly repository: PersonaRepository,
  ) {
    this.path =
      config.personaCorePath ?? join(homedir(), '.icos', 'persona', 'core.md');
    this.required = config.personaCoreRequired ?? true;
  }

  async onModuleInit(): Promise<void> {
    const status = await this.reload();
    if (this.required && !status.loaded) {
      throw new Error(
        'Refusing to start: the core persona is required but not available. ' +
          `path=${this.path} reason=${status.reason ?? 'unknown'}. ` +
          'Provide a valid core file at PERSONA_CORE_PATH, or set ' +
          'PERSONA_CORE_REQUIRED=false to allow a degraded (dev/throwaway) boot.',
      );
    }
  }

  /** Re-read the core file. Read-only; safe to call at any time. */
  async reload(): Promise<PersonaCoreStatus> {
    const previous = await this.repository.getCoreState();
    const evaluatedAt = new Date().toISOString();

    let loaded = false;
    let reason: string | undefined;
    let hash: string | null = null;
    let entries: readonly PersonaCoreEntry[] = [];

    try {
      if (!existsSync(this.path)) {
        reason = `core persona file not found: ${this.path}`;
      } else {
        const raw = readFileSync(this.path);
        hash = createHash('sha256').update(raw).digest('hex');
        const parsed = parsePersonaCore(raw.toString('utf8'), this.path);
        for (const warning of parsed.warnings) {
          this.logger.warn(warning);
        }
        if (parsed.entries.length === 0) {
          reason =
            'core persona file had no recognized entries (check section headings)';
        } else {
          entries = parsed.entries;
          loaded = true;
        }
      }
    } catch (error) {
      reason = `core persona read failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }

    const changedSinceLastLoad =
      loaded && previous?.hash != null && previous.hash !== hash;

    if (changedSinceLastLoad) {
      this.logger.log(
        `Core persona changed on disk (hash ${previous?.hash} -> ${hash}).`,
      );
      await this.repository.logDrift({
        userId: DEFAULT_PERSONA_USER_ID,
        subjectId: 'persona-core',
        severity: 'info',
        changeType: 'persona_core_changed',
        previousValue: previous?.hash ?? null,
        newValue: hash,
        reason: 'Core persona file changed on disk (human edit).',
      });
    }

    if (!loaded && previous?.loaded) {
      await this.repository.logDrift({
        userId: DEFAULT_PERSONA_USER_ID,
        subjectId: 'persona-core',
        severity: 'warning',
        changeType: 'persona_core_unavailable',
        previousValue: previous.hash,
        reason: reason ?? 'core persona unavailable',
      });
    }

    if (loaded) {
      this.logger.log(
        `Core persona loaded: ${entries.length} immutable entries from ${this.path}.`,
      );
    } else {
      this.logger.error(
        `Core persona NOT loaded (degraded identity): ${reason}`,
      );
    }

    await this.repository.saveCoreState({
      path: this.path,
      hash,
      entryCount: entries.length,
      loaded,
      reason: reason ?? null,
      updatedAt: evaluatedAt,
    });

    this.snapshot = {
      loaded,
      hash,
      entries,
      evaluatedAt,
      reason,
      changedSinceLastLoad,
    };
    return this.getStatus();
  }

  getEntries(): readonly PersonaCoreEntry[] {
    return this.snapshot.entries;
  }

  isLoaded(): boolean {
    return this.snapshot.loaded;
  }

  getStatus(): PersonaCoreStatus {
    return {
      loaded: this.snapshot.loaded,
      path: this.path,
      hash: this.snapshot.hash,
      entryCount: this.snapshot.entries.length,
      evaluatedAt: this.snapshot.evaluatedAt,
      reason: this.snapshot.reason,
      changedSinceLastLoad: this.snapshot.changedSinceLastLoad,
    };
  }
}
