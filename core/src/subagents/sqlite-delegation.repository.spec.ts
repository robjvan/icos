import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { SessionDatabaseService } from '../session/session-database.service';
import { SqliteSessionRepository } from '../session/sqlite-session.repository';
import { SqliteDelegationRepository } from './sqlite-delegation.repository';

describe('SqliteDelegationRepository', () => {
  let dir = '';
  let database: SessionDatabaseService;
  let repository: SqliteDelegationRepository;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'icos-delegations-'));
    database = new SessionDatabaseService({
      sessionDbPath: join(dir, 'sessions.sqlite'),
    } as CoreConfig);
    database.onModuleInit();
    const sessions = new SqliteSessionRepository(database);
    await sessions.createSession('parent-1');
    await sessions.createSession('child-1');
    await sessions.createSession('child-2');
    repository = new SqliteDelegationRepository(database);
  });

  afterEach(() => {
    database.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  });

  const budgets = {
    maxIterations: 5,
    maxToolSteps: 5,
    maxTurnDurationMs: 300000,
  };

  it('creates running delegations and reads them back', async () => {
    const created = await repository.create({
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      parentRunId: null,
      goal: 'research widgets',
      budgets,
    });
    expect(created).toMatchObject({
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      goal: 'research widgets',
      state: 'running',
      resultSummary: null,
      cancelRequested: false,
    });
    expect(await repository.get(created.id)).toEqual(created);
    expect(
      (await repository.listByParent('parent-1')).map((d) => d.id),
    ).toContain(created.id);
  });

  it('tracks child sessions and the running count', async () => {
    expect(await repository.isChildSession('child-1')).toBe(false);
    expect(await repository.runningCount()).toBe(0);
    const created = await repository.create({
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      parentRunId: null,
      goal: 'g',
      budgets,
    });
    expect(await repository.isChildSession('child-1')).toBe(true);
    expect(await repository.isChildSession('parent-1')).toBe(false);
    expect(await repository.runningCount()).toBe(1);
    await repository.setState(created.id, 'completed', {
      resultSummary: 'done',
    });
    expect(await repository.runningCount()).toBe(0);
  });

  it('requests cancel cooperatively and never regresses terminal states', async () => {
    const created = await repository.create({
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      parentRunId: null,
      goal: 'g',
      budgets,
    });
    expect(await repository.isCancelRequested('child-1')).toBe(false);
    await repository.requestCancel(created.id);
    expect(await repository.isCancelRequested('child-1')).toBe(true);
    // State itself is untouched — the child loop observes the flag.
    expect((await repository.get(created.id))?.state).toBe('running');

    await repository.setState(created.id, 'completed', {
      resultSummary: 'done',
    });
    const again = await repository.requestCancel(created.id);
    expect(again?.state).toBe('completed');
    expect(again?.resultSummary).toBe('done');
  });

  it('fails non-terminal delegations on restart, honestly', async () => {
    const a = await repository.create({
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      parentRunId: null,
      goal: 'a',
      budgets,
    });
    const b = await repository.create({
      parentSessionId: 'parent-1',
      childSessionId: 'child-2',
      parentRunId: null,
      goal: 'b',
      budgets,
    });
    await repository.setState(b.id, 'awaiting_approval');
    const c = await repository.create({
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      parentRunId: null,
      goal: 'c',
      budgets,
    });
    await repository.setState(c.id, 'completed', { resultSummary: 'done' });

    const marked = await repository.failNonTerminal('restart');
    expect(marked.sort()).toEqual([a.id, b.id].sort());
    expect((await repository.get(a.id))?.state).toBe('failed');
    expect((await repository.get(a.id))?.error).toBe('restart');
    expect((await repository.get(b.id))?.state).toBe('failed');
    expect((await repository.get(c.id))?.state).toBe('completed');
  });

  it('returns null for unknown ids', async () => {
    expect(await repository.get('nope')).toBeNull();
    expect(await repository.setState('nope', 'failed')).toBeNull();
    expect(await repository.requestCancel('nope')).toBeNull();
  });
});
