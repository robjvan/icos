import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { SkillService } from './skill.service';
import { SkillSeedService } from './skill-seed.service';

describe('SkillSeedService', () => {
  let source: string;
  let target: string;
  let service: SkillSeedService;

  beforeEach(() => {
    source = mkdtempSync(join(tmpdir(), 'icos-seed-src-'));
    target = mkdtempSync(join(tmpdir(), 'icos-seed-dst-'));
    const skills = new SkillService({
      skillsEnabled: true,
      skillsDirPath: target,
      skillsMaxBodyChars: 64 * 1024,
    } as unknown as CoreConfig);
    service = new SkillSeedService(
      { skillsSeedRoot: source } as unknown as CoreConfig,
      skills,
    );
  });

  afterEach(() => {
    rmSync(source, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  });

  function writeSkill(
    root: string,
    category: string,
    name: string,
    description: string,
  ): void {
    mkdirSync(join(root, category, name), { recursive: true });
    writeFileSync(
      join(root, category, name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`,
    );
  }

  it('copies shipped skills without overwriting existing files', async () => {
    writeSkill(source, 'research', 'arxiv', 'Papers.');
    writeSkill(source, 'apple', 'imessage', 'Messages.');
    // A pre-existing user edit at the target must survive.
    mkdirSync(join(target, 'research', 'arxiv'), { recursive: true });
    writeFileSync(
      join(target, 'research', 'arxiv', 'SKILL.md'),
      '---\nname: arxiv\ndescription: USER EDITED\n---\n\nEdited.\n',
    );

    const report = await service.seed();
    expect(report.copied).toBe(1);
    expect(report.skipped).toBe(1);
    expect(
      readFileSync(join(target, 'research', 'arxiv', 'SKILL.md'), 'utf8'),
    ).toContain('USER EDITED');
    expect(existsSync(join(target, 'apple', 'imessage', 'SKILL.md'))).toBe(
      true,
    );
  });

  it('is idempotent', async () => {
    writeSkill(source, 'research', 'arxiv', 'Papers.');
    const first = await service.seed();
    expect(first.copied).toBe(1);
    const second = await service.seed();
    expect(second.copied).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('force overwrites existing files (M18.y)', async () => {
    writeSkill(source, 'research', 'arxiv', 'SHIPPED');
    mkdirSync(join(target, 'research', 'arxiv'), { recursive: true });
    writeFileSync(
      join(target, 'research', 'arxiv', 'SKILL.md'),
      '---\nname: arxiv\ndescription: USER EDITED\n---\n\nEdited.\n',
    );

    const report = await service.seed({ force: true });
    expect(report.overwritten).toBe(1);
    expect(report.copied).toBe(0);
    expect(report.skipped).toBe(0);
    expect(
      readFileSync(join(target, 'research', 'arxiv', 'SKILL.md'), 'utf8'),
    ).toContain('SHIPPED');
  });
});
