import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { DatabaseService } from '../session/database.service';
import { PersonaCoreService } from './persona-core.service';
import { PersonaDatabaseService } from './persona-database.service';
import { SqlitePersonaRepository } from './sqlite-persona.repository';

const CORE_V1 = [
  '# ICOS Core',
  '',
  '## Ethical Grounding',
  '- Prefer truth over comfort.',
  '',
  '## Safety Boundaries',
  '- Never exfiltrate credentials.',
].join('\n');

const CORE_V2 = [
  '# ICOS Core',
  '',
  '## Ethical Grounding',
  '- Prefer truth over comfort, always.',
  '',
  '## Safety Boundaries',
  '- Never exfiltrate credentials.',
].join('\n');

function testConfig(
  dir: string,
  corePath: string,
  required = false,
): CoreConfig {
  return {
    port: 3000,
    host: '127.0.0.1',
    corsAllowedOrigins: ['http://localhost:4200', 'http://127.0.0.1:4200'],
    exposeAcknowledged: false,
    authEnabled: false,
    authDirPath: '/tmp/icos-test-auth-unused',
    authSessionTtlMs: 2592000000,
    authCookieSecure: false,
    provider: 'ollama',
    llmBaseUrl: 'http://localhost:11434/v1',
    llmModel: 'm',
    llmTimeoutMs: 1000,
    systemPrompt: 'sys',
    maxHistory: 50,
    sessionDbPath: join(dir, 'sessions-unused.sqlite'),
    memoryDbPath: join(dir, 'memories-unused.sqlite'),
    personaDbPath: join(dir, 'persona.sqlite'),
    personaCorePath: corePath,
    personaCoreRequired: required,
    legacyDbPath: join(dir, 'legacy-missing.sqlite'),
    memoryExtractionEnabled: true,
    memoryProvider: 'ollama',
    memoryLlmBaseUrl: 'http://localhost:11434/v1',
    memoryLlmModel: 'mem',
    memoryLlmTimeoutMs: 1000,
    memoryPromotionAuto: false,
    memoryPromotionAutoKinds: [],
    memoryProspectiveConfidenceThreshold: 0.5,
    memoryRecallConfidenceGate: 0.3,
    memoryRecallExcludeOrigins: [],
    memoryRecallMaxBandTokens: 800,
    memoryRecallTimeoutMs: 5000,
    memoryMaintenanceEnabled: true,
    memoryMaintenanceIntervalMs: 3600000,
    memoryAgentDampening: 0.5,
    mcpEnabled: false,
    mcpServersPath: '',
    mcpTimeoutMs: 30000,
    mcpReconnectBackoffMs: 60000,
    vectorDbPath: join(dir, 'claims-vector-test.db'),
    skillsDirPath: join(dir, 'skills-unused'),
    skillsEnabled: true,
    skillsMaxBodyChars: 12000,
    skillsMaxCatalogItems: 50,
    skillsMaxActivePerSession: 5,
    skillsMaxAutoLoadedPerTurn: 2,
    skillsMaxContextChars: 8000,
    agentMaxIterations: 5,
    agentMaxToolSteps: 5,
    agentMaxTurnDurationMs: 900000,
    realtimeEnabled: false,
    realtimeHeartbeatMs: 30000,
    realtimeAllowedOrigins: ['*'],
  };
}

describe('PersonaCoreService', () => {
  let dir = '';
  let corePath = '';
  const services: DatabaseService[] = [];

  const setup = async (coreContent?: string, required = false) => {
    if (coreContent !== undefined) {
      writeFileSync(corePath, coreContent);
    }
    const config = testConfig(dir, corePath, required);
    const db = new PersonaDatabaseService(config);
    db.onModuleInit();
    services.push(db);
    const repository = new SqlitePersonaRepository(db);
    const service = new PersonaCoreService(config, repository);
    await service.onModuleInit();
    return { repository, service };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-core-'));
    corePath = join(dir, 'core.md');
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads a valid core, hashes it, and records the load', async () => {
    const { repository, service } = await setup(CORE_V1);

    const status = service.getStatus();
    expect(status.loaded).toBe(true);
    expect(status.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(status.entryCount).toBeGreaterThan(0);
    expect(status.changedSinceLastLoad).toBe(false);
    expect(service.getEntries().every((entry) => entry.immutable)).toBe(true);
    expect(service.isLoaded()).toBe(true);
    expect((await repository.getCoreState())?.loaded).toBe(true);
  });

  it('reports a loud degraded status when the core file is missing', async () => {
    const { repository, service } = await setup();

    const status = service.getStatus();
    expect(status.loaded).toBe(false);
    expect(status.reason).toMatch(/not found/);
    expect(service.getEntries()).toHaveLength(0);
    expect((await repository.getCoreState())?.loaded).toBe(false);
    // First-boot absence is not an audit event; it is the initial state.
    expect(await repository.listRecentDrift('user')).toHaveLength(0);
  });

  it('treats a file with no recognized entries as invalid', async () => {
    const { service } = await setup(
      '# Just a title\n\n## Unknown\n- nothing here',
    );
    const status = service.getStatus();
    expect(status.loaded).toBe(false);
    expect(status.reason).toMatch(/no recognized entries/);
  });

  it('records a human core edit as an info audit entry, once, not drift', async () => {
    const { repository, service } = await setup(CORE_V1);
    const firstHash = service.getStatus().hash;

    writeFileSync(corePath, CORE_V2);
    await service.reload();

    const status = service.getStatus();
    expect(status.hash).not.toBe(firstHash);
    expect(status.changedSinceLastLoad).toBe(true);
    expect(status.loaded).toBe(true);

    const audit = (await repository.listRecentDrift('user')).filter(
      (entry) => entry.changeType === 'persona_core_changed',
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].severity).toBe('info');

    // A reload with no further change does not re-audit.
    await service.reload();
    expect(service.getStatus().changedSinceLastLoad).toBe(false);
    expect(
      (await repository.listRecentDrift('user')).filter(
        (entry) => entry.changeType === 'persona_core_changed',
      ),
    ).toHaveLength(1);
  });

  it('flags the loss of a previously loaded core', async () => {
    const { repository, service } = await setup(CORE_V1);
    expect(service.isLoaded()).toBe(true);

    rmSync(corePath, { force: true });
    await service.reload();

    expect(service.getStatus().loaded).toBe(false);
    const audit = (await repository.listRecentDrift('user')).filter(
      (entry) => entry.changeType === 'persona_core_unavailable',
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].severity).toBe('warning');
  });

  it('boots when the core is required and present', async () => {
    const { service } = await setup(CORE_V1, true);
    expect(service.isLoaded()).toBe(true);
  });

  it('refuses to boot when the core is required but missing', async () => {
    const config = testConfig(dir, corePath, true);
    const db = new PersonaDatabaseService(config);
    db.onModuleInit();
    services.push(db);
    const service = new PersonaCoreService(
      config,
      new SqlitePersonaRepository(db),
    );
    await expect(service.onModuleInit()).rejects.toThrow(/required/);
  });
});
