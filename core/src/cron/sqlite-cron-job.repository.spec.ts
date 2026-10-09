import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { SessionDatabaseService } from '../session/session-database.service';
import { SqliteSessionRepository } from '../session/sqlite-session.repository';
import { SqliteCronJobRepository } from './sqlite-cron-job.repository';

describe('SqliteCronJobRepository', () => {
  let dir = '';
  let database: SessionDatabaseService;
  let repository: SqliteCronJobRepository;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'icos-cron-'));
    database = new SessionDatabaseService({
      sessionDbPath: join(dir, 'sessions.sqlite'),
    } as CoreConfig);
    database.onModuleInit();
    const sessions = new SqliteSessionRepository(database);
    await sessions.createSession('s1');
    repository = new SqliteCronJobRepository(database);
  });

  afterEach(() => {
    database.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates, lists, pauses, resumes, and removes jobs', async () => {
    const created = await repository.create({
      name: 'morning',
      schedule: '0 9 * * *',
      prompt: 'summarize',
      sessionId: 's1',
      nextRunAt: '2026-10-09T09:00:00.000Z',
    });
    expect(created).toMatchObject({
      name: 'morning',
      enabled: true,
      sessionId: 's1',
    });
    expect((await repository.list()).map((j) => j.id)).toContain(created.id);

    const paused = await repository.setEnabled(created.id, false, null);
    expect(paused?.enabled).toBe(false);

    const resumed = await repository.setEnabled(
      created.id,
      true,
      '2026-10-10T09:00:00.000Z',
    );
    expect(resumed?.enabled).toBe(true);
    expect(resumed?.nextRunAt).toBe('2026-10-10T09:00:00.000Z');

    expect(await repository.remove(created.id)).toBe(true);
    expect(await repository.get(created.id)).toBeNull();
  });

  it('returns only due, enabled jobs', async () => {
    const due = await repository.create({
      name: 'due',
      schedule: '* * * * *',
      prompt: 'now',
      sessionId: 's1',
      nextRunAt: '2026-10-09T08:00:00.000Z',
    });
    await repository.create({
      name: 'future',
      schedule: '* * * * *',
      prompt: 'later',
      sessionId: 's1',
      nextRunAt: '2026-10-09T09:00:00.000Z',
    });
    const paused = await repository.create({
      name: 'paused',
      schedule: '* * * * *',
      prompt: 'paused',
      sessionId: 's1',
      nextRunAt: '2026-10-09T07:00:00.000Z',
    });
    await repository.setEnabled(paused.id, false, null);

    const found = await repository.due('2026-10-09T08:30:00.000Z');
    expect(found.map((j) => j.id)).toEqual([due.id]);
  });

  it('records a run', async () => {
    const job = await repository.create({
      name: 'j',
      schedule: '* * * * *',
      prompt: 'p',
      sessionId: 's1',
      nextRunAt: '2026-10-09T08:00:00.000Z',
    });
    await repository.recordRun(
      job.id,
      '2026-10-09T08:00:00.000Z',
      '2026-10-09T08:01:00.000Z',
    );
    const found = await repository.get(job.id);
    expect(found?.lastRunAt).toBe('2026-10-09T08:00:00.000Z');
    expect(found?.nextRunAt).toBe('2026-10-09T08:01:00.000Z');
  });
});
