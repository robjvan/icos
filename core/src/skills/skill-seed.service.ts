import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { SkillService } from './skill.service';

export interface SeedReport {
  source: string;
  target: string;
  /** New files written this run. */
  copied: number;
  /** Existing files replaced (only with `force`). */
  overwritten: number;
  /** Files left alone because the destination already existed. */
  skipped: number;
}

/**
 * M18.1 skill seeding. On startup (and on demand via `/skills seed`) the
 * shipped collection is copied into the runtime skills dir, **never
 * overwriting** an existing file — user edits always win, and deleting a skill
 * re-seeds it on the next run. M18.y adds an explicit `force` mode that
 * overwrites existing files so shipped updates can propagate. The source
 * defaults to the app's own `skills/` directory (baked into the image);
 * `SKILLS_SEED_ROOT` overrides it.
 */
@Injectable()
export class SkillSeedService implements OnModuleInit {
  private readonly logger = new Logger(SkillSeedService.name);

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly skills: SkillService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.skillsSeedEnabled === false) return;
    try {
      const report = await this.seed();
      if (report.copied > 0) {
        this.logger.log(
          `Seeded ${String(report.copied)} skill files into ${report.target} (${String(report.skipped)} already present).`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Skill seed failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  /**
   * Copy shipped skills into the runtime dir. Default: never overwrite an
   * existing file (user edits win). With `force`, existing files are replaced
   * by the shipped versions so an adapted shipped skill reaches a runtime copy
   * that already exists — local edits to those files are lost.
   */
  async seed(options: { force?: boolean } = {}): Promise<SeedReport> {
    const force = options.force === true;
    const source = this.seedRoot();
    const target = this.skills.skillsDir;
    let copied = 0;
    let overwritten = 0;
    let skipped = 0;

    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(join(dir, entry.name), childRel);
          continue;
        }
        if (!entry.isFile()) continue;
        const dest = join(target, childRel);
        const exists = existsSync(dest);
        if (exists && !force) {
          skipped += 1;
          continue;
        }
        await fs.mkdir(join(target, rel), { recursive: true });
        await fs.copyFile(join(dir, entry.name), dest);
        if (exists) overwritten += 1;
        else copied += 1;
      }
    };

    await walk(source, '');
    await this.skills.refresh();
    return { source, target, copied, overwritten, skipped };
  }

  /** The shipped-skills source dir (override, else the app's `skills/`). */
  private seedRoot(): string {
    return this.config.skillsSeedRoot ?? join(process.cwd(), 'skills');
  }
}
