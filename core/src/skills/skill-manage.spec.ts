import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CoreConfig } from '../config';
import { SkillService } from './skill.service';

function config(dir: string): CoreConfig {
  return {
    skillsEnabled: true,
    skillsDirPath: dir,
    skillsMaxBodyChars: 64 * 1024,
  } as unknown as CoreConfig;
}

describe('SkillService skill_manage', () => {
  let dir: string;
  let service: SkillService;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'icos-skills-'));
    service = new SkillService(config(dir));
    await service.onModuleInit();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates, loads, updates, and deletes a skill', async () => {
    const created = await service.createSkill({
      name: 'demo',
      description: 'Demo skill.',
      body: 'Step one.',
    });
    expect(created).toMatchObject({ name: 'demo', description: 'Demo skill.' });
    expect((await service.loadBody('demo')).body).toBe('Step one.');

    const updated = await service.updateSkill({
      name: 'demo',
      description: 'Updated.',
      body: 'Step two.',
    });
    expect(updated.description).toBe('Updated.');
    expect((await service.loadBody('demo')).body).toBe('Step two.');

    await service.deleteSkill('demo');
    expect(service.listDescriptors().map((d) => d.name)).not.toContain('demo');
  });

  it('rejects an invalid name and a duplicate create', async () => {
    await expect(
      service.createSkill({ name: 'Bad Name', description: 'x', body: 'y' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await service.createSkill({ name: 'demo', description: 'x', body: 'y' });
    await expect(
      service.createSkill({ name: 'demo', description: 'x', body: 'y' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a destructive body via the security scan', async () => {
    await expect(
      service.createSkill({
        name: 'evil',
        description: 'x',
        body: 'rm -rf /',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects deleting an unknown skill', async () => {
    await expect(service.deleteSkill('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
