import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { MemoryDatabaseService } from '../memory/memory-database.service';
import { SqliteHallucinationLedgerRepository } from './sqlite-hallucination-ledger.repository';

describe('SqliteHallucinationLedgerRepository (M15.5d)', () => {
  let dir = '';
  const services: MemoryDatabaseService[] = [];

  const open = (): SqliteHallucinationLedgerRepository => {
    const config = {
      memoryDbPath: join(dir, 'memories.sqlite'),
      sessionDbPath: join(dir, 'sessions.sqlite'),
      legacyDbPath: join(dir, 'legacy-missing.sqlite'),
    } as unknown as CoreConfig;
    const db = new MemoryDatabaseService(config);
    db.onModuleInit();
    services.push(db);
    return new SqliteHallucinationLedgerRepository(db);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-mitig-'));
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('records and lists entries, carrying the finding and its detail', async () => {
    const repository = open();
    const first = await repository.record({
      severity: 'critical',
      strategy: 'refuse',
      mode: 'contradicted_claim',
      reason: 'store contradicts',
      subject: 'user prefers oak',
      detail: { candidateId: 'c1' },
    });
    expect(first).toMatchObject({
      severity: 'critical',
      strategy: 'refuse',
      mode: 'contradicted_claim',
      subject: 'user prefers oak',
      detail: { candidateId: 'c1' },
    });

    const second = await repository.record({
      severity: 'watch',
      strategy: 'flag',
      reason: 'novel',
    });

    const listed = await repository.list();
    expect(listed.map((entry) => entry.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(await repository.list(1)).toHaveLength(1);
  });

  it('persists across close and reopen', async () => {
    const path = join(dir, 'persist.sqlite');
    const config = {
      memoryDbPath: path,
      sessionDbPath: join(dir, 'sessions-unused.sqlite'),
      legacyDbPath: join(dir, 'legacy-missing.sqlite'),
    } as unknown as CoreConfig;

    const first = new MemoryDatabaseService(config);
    first.onModuleInit();
    await new SqliteHallucinationLedgerRepository(first).record({
      severity: 'warning',
      strategy: 'flag',
      reason: 'unsupported',
    });
    first.onModuleDestroy();

    const second = new MemoryDatabaseService(config);
    second.onModuleInit();
    services.push(second);
    expect(
      await new SqliteHallucinationLedgerRepository(second).list(),
    ).toHaveLength(1);
  });

  it('liveness probe', async () => {
    await expect(open().ping()).resolves.toBeUndefined();
  });
});
