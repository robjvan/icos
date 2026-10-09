import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { SessionDatabaseService } from './session-database.service';
import { SqliteSessionRepository } from './sqlite-session.repository';
import { SqliteTodoRepository } from './sqlite-todo.repository';

describe('SqliteTodoRepository', () => {
  let dir = '';
  let database: SessionDatabaseService;
  let repository: SqliteTodoRepository;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'icos-todo-'));
    database = new SessionDatabaseService({
      sessionDbPath: join(dir, 'sessions.sqlite'),
    } as CoreConfig);
    database.onModuleInit();
    const sessions = new SqliteSessionRepository(database);
    await sessions.createSession('s1');
    await sessions.createSession('s2');
    repository = new SqliteTodoRepository(database);
  });

  afterEach(() => {
    database.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  });

  it('adds, lists, completes, removes, and clears per session', async () => {
    const first = await repository.add('s1', 'first');
    await repository.add('s1', 'second');
    await repository.add('s2', 'other');

    expect((await repository.list('s1')).map((t) => t.text)).toEqual([
      'first',
      'second',
    ]);
    expect((await repository.list('s2')).map((t) => t.text)).toEqual(['other']);

    const done = await repository.complete('s1', first.id);
    expect(done?.status).toBe('done');
    // Already done → no-op; wrong session → not found.
    expect(await repository.complete('s1', first.id)).toBeNull();
    expect(await repository.complete('s2', first.id)).toBeNull();

    expect(await repository.remove('s1', first.id)).toBe(true);
    expect(await repository.remove('s1', first.id)).toBe(false);

    expect(await repository.clear('s1')).toBe(1);
    expect(await repository.list('s1')).toEqual([]);
  });
});
