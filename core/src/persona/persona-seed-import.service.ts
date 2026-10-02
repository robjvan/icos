import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { createId } from './persona-ids';
import { hasTemplatePlaceholder } from './persona-markdown';
import { parsePersonaSeed, type PersonaSeedCandidate } from './persona-seed';
import { PersonaRepository } from './persona.repository';
import type {
  PersonaCandidateCategory,
  PersonaCategory,
  PersonaRecord,
  PersonaSeedImportResult,
  PersonaSeedSourceInput,
} from './persona.types';

const MAX_SOURCES = 20;

export interface PersonaSeedImportInput {
  userId: string;
  agentId: string;
  reviewedBy: string;
  sources: PersonaSeedSourceInput[];
  dryRun?: boolean;
}

/**
 * Persona seed import (M14c): bootstrap the **evolving** tier from
 * guarded Markdown. The immutable core is never a seed target.
 *
 * Guarantees:
 * - paths are relative, `.md`-only, and confined to `PERSONA_SEED_ROOT`
 *   (realpath containment);
 * - imports are idempotent by content hash;
 * - a changed seed updates only its own untouched `seeded` baseline;
 *   anything else is **staged as a candidate**, never an overwrite;
 * - a dry run writes nothing.
 */
@Injectable()
export class PersonaSeedImportService {
  private readonly logger = new Logger(PersonaSeedImportService.name);

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly repository: PersonaRepository,
  ) {}

  async import(
    input: PersonaSeedImportInput,
  ): Promise<PersonaSeedImportResult> {
    this.validateRequest(input);
    const importedAt = new Date().toISOString();
    const root = this.resolveSeedRoot();
    const result: PersonaSeedImportResult = {
      userId: input.userId,
      agentId: input.agentId,
      seedRoot: root,
      importedAt,
      dryRun: input.dryRun ?? false,
      created: 0,
      updated: 0,
      unchanged: 0,
      conflictsStaged: 0,
      skipped: 0,
      sourceFiles: [],
      recordIds: [],
      changedRecordIds: [],
      candidateIds: [],
      warnings: [],
    };

    for (const source of input.sources) {
      const resolved = this.resolveSource(root, source.path);
      const markdown = readFileSync(resolved.absolutePath, 'utf8');
      const candidates = parsePersonaSeed(markdown, source.kind);
      result.sourceFiles.push(resolved.relativePath);
      if (candidates.length === 0) {
        result.warnings.push(
          `${resolved.relativePath}: no importable persona statements found.`,
        );
        continue;
      }
      for (const candidate of candidates) {
        if (hasTemplatePlaceholder(candidate.content)) {
          result.skipped += 1;
          continue;
        }
        await this.applyCandidate(
          input,
          resolved.relativePath,
          importedAt,
          candidate,
          result,
        );
      }
    }

    this.logger.log(
      `Persona seed import: ${result.created} created, ${result.updated} updated, ` +
        `${result.unchanged} unchanged, ${result.conflictsStaged} conflicts staged, ` +
        `${result.skipped} skipped`,
    );
    return result;
  }

  private async applyCandidate(
    input: PersonaSeedImportInput,
    sourcePath: string,
    importedAt: string,
    candidate: PersonaSeedCandidate,
    result: PersonaSeedImportResult,
  ): Promise<void> {
    const recordId = createId(
      'seed-record',
      `${input.agentId}:${input.userId}:${sourcePath}:${candidate.key}`,
    );
    const source = `seed:${sourcePath}`;
    const contentHash = hash(candidate.content);
    const existing = await this.repository.getRecord(recordId);

    if (existing?.content === candidate.content) {
      result.unchanged += 1;
      result.recordIds.push(recordId);
      return;
    }

    if (existing && !this.canReplaceSeedBaseline(existing, source)) {
      const candidateId = createId(
        'seed-conflict',
        `${recordId}:${contentHash}`,
      );
      if (!input.dryRun) {
        await this.repository.stageCandidate({
          candidateId,
          userId: input.userId,
          observation: candidate.content,
          category: toCandidateCategory(candidate.category),
          confidence: 0.9,
          source,
          proposedTarget: 'persona_record',
          metadata: {
            agentId: input.agentId,
            seedUpdate: true,
            targetRecordId: recordId,
            previousContent: existing.content,
            conflictsWithProtectedAnchor: existing.protected,
            sourcePath,
            importedAt,
          },
          occurredAt: importedAt,
        });
      }
      result.conflictsStaged += 1;
      result.candidateIds.push(candidateId);
      return;
    }

    if (!input.dryRun) {
      await this.repository.createRecord({
        recordId,
        userId: input.userId,
        category: candidate.category,
        content: candidate.content,
        confidence: 0.95,
        sensitivity: candidate.sensitivity,
        protected: candidate.protected,
        source,
        reviewedBy: input.reviewedBy,
        metadata: {
          agentId: input.agentId,
          seeded: true,
          seedLayer: candidate.layer,
          seedSourcePath: sourcePath,
          seedContentHash: contentHash,
          importedAt,
        },
        occurredAt: importedAt,
      });
    }
    if (existing) {
      result.updated += 1;
    } else {
      result.created += 1;
    }
    result.recordIds.push(recordId);
    result.changedRecordIds.push(recordId);
  }

  private canReplaceSeedBaseline(
    existing: PersonaRecord,
    source: string,
  ): boolean {
    const metadata = existing.metadata ?? {};
    return (
      metadata.seeded === true &&
      existing.source === source &&
      metadata.seedContentHash === hash(existing.content)
    );
  }

  private validateRequest(input: PersonaSeedImportInput): void {
    if (
      !input.userId?.trim() ||
      !input.agentId?.trim() ||
      !input.reviewedBy?.trim()
    ) {
      throw new BadRequestException(
        'userId, agentId, and reviewedBy are required for seed import.',
      );
    }
    if (!Array.isArray(input.sources) || input.sources.length === 0) {
      throw new BadRequestException('At least one seed source is required.');
    }
    if (input.sources.length > MAX_SOURCES) {
      throw new BadRequestException(
        `A seed import may contain at most ${MAX_SOURCES} files.`,
      );
    }
    for (const source of input.sources) {
      if (!source || !['soul', 'persona'].includes(source.kind)) {
        throw new BadRequestException(
          'Seed source kind must be soul or persona.',
        );
      }
    }
  }

  private resolveSeedRoot(): string {
    const configured =
      this.config.personaSeedRoot ?? join(homedir(), '.icos', 'seeds');
    const root = resolve(configured);
    try {
      return realpathSync(root);
    } catch {
      throw new BadRequestException(
        `Persona seed root does not exist: ${root}`,
      );
    }
  }

  private resolveSource(
    root: string,
    sourcePath: string,
  ): { absolutePath: string; relativePath: string } {
    if (!sourcePath || isAbsolute(sourcePath)) {
      throw new BadRequestException('Seed source paths must be relative.');
    }
    if (!sourcePath.toLowerCase().endsWith('.md')) {
      throw new BadRequestException('Seed sources must be Markdown files.');
    }
    let absolutePath: string;
    try {
      absolutePath = realpathSync(resolve(root, sourcePath));
    } catch {
      throw new BadRequestException(
        `Seed source does not exist: ${sourcePath}`,
      );
    }
    const relativePath = relative(root, absolutePath);
    if (
      relativePath === '..' ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      throw new BadRequestException('Seed source escapes PERSONA_SEED_ROOT.');
    }
    return { absolutePath, relativePath };
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function toCandidateCategory(
  category: PersonaCategory,
): PersonaCandidateCategory {
  switch (category) {
    case 'boundary':
      return 'boundary';
    case 'relationship':
      return 'relationship';
    case 'value':
      return 'value';
    case 'belief':
      return 'belief';
    default:
      return 'identity';
  }
}
