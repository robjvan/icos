import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { SqliteApprovalRepository } from '../approvals/sqlite-approval.repository';
import { ApprovalService } from '../approvals/approval.service';
import { SessionDatabaseService } from '../session/session-database.service';
import { DatabaseService } from '../session/database.service';
import { MemoryDatabaseService } from './memory-database.service';
import type { MemoryCandidate, NewMemoryCandidate } from './memory-candidate';
import { SqliteMemoryCandidateRepository } from './sqlite-memory-candidate.repository';
import { SqliteClaimRepository } from './sqlite-claim.repository';
import { SqlitePromotionJournalRepository } from './sqlite-promotion-journal.repository';
import { SqliteProspectiveItemRepository } from './sqlite-prospective-item.repository';
import { PromotionService } from './promotion.service';
import { NoopPublisher } from '../realtime/noop.publisher';
import type { RealtimeEvent } from '../realtime/realtime-event';

function testConfig(
  memoryDbPath: string,
  dir: string,
  overrides: Partial<CoreConfig> = {},
): CoreConfig {
  return {
    port: 3000,
    provider: 'ollama',
    llmBaseUrl: 'http://localhost:11434/v1',
    llmModel: 'm',
    llmTimeoutMs: 1000,
    systemPrompt: 'sys',
    maxHistory: 50,
    sessionDbPath: join(dir, 'sessions-unused.sqlite'),
    memoryDbPath,
    legacyDbPath: join(dir, 'legacy-missing.sqlite'),
    memoryExtractionEnabled: true,
    memoryProvider: 'ollama',
    memoryLlmBaseUrl: 'http://localhost:11434/v1',
    memoryLlmModel: 'mem',
    memoryLlmTimeoutMs: 1000,
    memoryPromotionAuto: false,
    memoryPromotionAutoKinds: [],
    memoryProspectiveConfidenceThreshold: 0.5,
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
    ...overrides,
  };
}

const candidate = (
  sessionId: string,
  object = 'TypeScript',
  overrides: Partial<NewMemoryCandidate> = {},
): NewMemoryCandidate => ({
  kind: 'preference',
  subject: 'user',
  predicate: 'prefers',
  object,
  confidence: 0.9,
  importance: 0.7,
  stability: 0.8,
  sourceRole: 'user',
  source: { sessionId, messageId: 1, role: 'user' },
  extractorModel: 'mem',
  extractorVersion: 'memory-extraction-v2',
  negated: false,
  ...overrides,
});

describe('PromotionService', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const setup = (overrides: Partial<CoreConfig> = {}) => {
    const config = testConfig(join(dir, 'memories.sqlite'), dir, overrides);
    const service = new MemoryDatabaseService(config);
    service.onModuleInit();
    services.push(service);
    const sessionService = new SessionDatabaseService(config);
    sessionService.onModuleInit();
    services.push(sessionService);
    const candidates = new SqliteMemoryCandidateRepository(service);
    const claims = new SqliteClaimRepository(service);
    const journal = new SqlitePromotionJournalRepository(service);
    const prospective = new SqliteProspectiveItemRepository(service);
    const approvals = new SqliteApprovalRepository(sessionService);
    // ApprovalService.create binds sessions; the unit approval path
    // delegates straight to the real repository (e2e covers binding).
    const approvalService = {
      create: (input: {
        sessionId: string;
        action: string;
        description?: string;
      }) => approvals.createApproval(input),
    } as unknown as ApprovalService;
    const promotion = new PromotionService(
      config,
      candidates,
      claims,
      journal,
      approvalService,
      approvals,
      {
        indexClaim: jest.fn(() => Promise.resolve()),
        searchSimilar: jest.fn(() => Promise.resolve([])),
        status: jest.fn(() => Promise.resolve({ enabled: false })),
      },
      new NoopPublisher(),
      prospective,
    );
    // Approvals bind sessions by FK; the turn's session exists at runtime.
    sessionService.connection
      .prepare(
        'INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)',
      )
      .run('s1', 't', 't');
    return {
      promotion,
      candidates,
      claims,
      journal,
      prospective,
      approvals,
      db: service,
    };
  };

  const save = async (
    setupResult: ReturnType<typeof setup>,
    items: NewMemoryCandidate[],
  ): Promise<MemoryCandidate[]> => setupResult.candidates.saveCandidates(items);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-promo-'));
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('proposes NEW candidates with a memory.promote approval, HITL by default', async () => {
    const s = setup();
    const [saved] = await save(s, [candidate('s1')]);

    const [entry] = await s.promotion.proposeCandidates([saved]);
    expect(entry?.operation).toBe('NEW');
    expect(entry?.state).toBe('proposed');
    expect(entry?.approvalId).toBeDefined();

    const approval = await s.approvals.getApproval(entry.approvalId!);
    expect(approval?.action).toBe('memory.promote');
    expect(approval?.status).toBe('pending');
    expect(approval?.description).toContain('TypeScript');

    // Sweep before approval: skipped, nothing created.
    expect(await s.promotion.sweep()).toMatchObject({ skipped: 1, new: 0 });
    expect(await s.claims.listClaims()).toHaveLength(0);
  });

  it('proposes each candidate exactly once', async () => {
    const s = setup();
    const [saved] = await save(s, [candidate('s1')]);

    const [first] = await s.promotion.proposeCandidates([saved]);
    const [second] = await s.promotion.proposeCandidates([saved]);
    expect(second?.id).toBe(first?.id);
    expect(await s.approvals.listApprovals()).toHaveLength(1);
  });

  it('commits on approval via sweep with provenance intact', async () => {
    const s = setup();
    const [saved] = await save(s, [candidate('s1')]);
    const [entry] = await s.promotion.proposeCandidates([saved]);

    await s.approvals.resolveApproval(entry.approvalId!, 'approved');
    expect(await s.promotion.sweep()).toMatchObject({ new: 1 });

    const claims = await s.claims.listClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      subject: 'user',
      predicate: 'prefers',
      object: 'TypeScript',
      status: 'active',
      origin: 'user',
      confidence: 0.9,
      evidence: [{ candidateId: saved.id, role: 'user' }],
      promotion: `approved:${entry.approvalId}`,
    });
    const done = await s.journal.getEntry(entry.id);
    expect(done?.state).toBe('committed');
    expect(done?.claimId).toBe(claims[0].id);
    // The belief points back at its derivation, not just its evidence.
    expect(await s.journal.listByClaimId(claims[0].id)).toMatchObject([
      { operation: 'NEW', state: 'committed' },
    ]);
  });

  it('auto-commits admitted NEW kinds without approval when opted in', async () => {
    const s = setup({
      memoryPromotionAuto: true,
      memoryPromotionAutoKinds: ['fact'],
    });
    const [saved] = await save(s, [
      candidate('s1', 'teal', {
        kind: 'fact',
        subject: 'user',
        predicate: 'likes',
      }),
    ]);

    const [entry] = await s.promotion.proposeCandidates([saved]);
    expect(entry?.state).toBe('committed');
    expect(entry?.approvalId).toBeNull();

    const claims = await s.claims.listClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0]?.promotion).toBe('auto');
    expect(await s.approvals.listApprovals()).toHaveLength(0);
  });

  it('keeps auto off the table by default even for admitted-looking kinds', async () => {
    const s = setup();
    const [saved] = await save(s, [
      candidate('s1', 'teal', {
        kind: 'fact',
        subject: 'user',
        predicate: 'likes',
      }),
    ]);

    const [entry] = await s.promotion.proposeCandidates([saved]);
    expect(entry?.state).toBe('proposed');
    expect(entry?.approvalId).toBeDefined();
  });

  it('converges a repeated triple to REINFORCE, never a second claim', async () => {
    const s = setup();
    const [first] = await save(s, [candidate('s1')]);
    const [second] = await save(s, [candidate('s1')]);

    const [e1] = await s.promotion.proposeCandidates([first]);
    const [e2] = await s.promotion.proposeCandidates([second]);
    // Intent is advisory: no claim exists yet at proposal time, so the
    // second proposal reads NEW; convergence happens at execution.
    expect(e2?.operation).toBe('NEW');

    await s.approvals.resolveApproval(e1.approvalId!, 'approved');
    await s.approvals.resolveApproval(e2.approvalId!, 'approved');
    expect(await s.promotion.sweep()).toMatchObject({
      new: 1,
      reinforced: 1,
    });

    const claims = await s.claims.listClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0]?.evidence).toHaveLength(2);
    expect(claims[0]?.confidence).toBeCloseTo(0.95, 5);
    // Engine confidence moves; the extractor's observation never does.
    expect(claims[0]?.extractorConfidence).toBe(0.9);
    expect(claims[0]?.timesObserved).toBe(2);
    expect(claims[0]?.firstAssertedAt).toBe(first.id);
    expect((await s.journal.getEntry(e2.id))?.detail).toContain(
      'rederived:NEW->REINFORCE',
    );
  });

  it('contradicts on same subject+predicate with a new object', async () => {
    const s = setup();
    const [first] = await save(s, [candidate('s1', 'TypeScript')]);
    const [second] = await save(s, [candidate('s1', 'Rust')]);

    const [e1] = await s.promotion.proposeCandidates([first]);
    const [e2] = await s.promotion.proposeCandidates([second]);
    // Same advisory-intent rule as REINFORCE: conflict is detected
    // at execution, when the first claim exists.
    expect(e2?.operation).toBe('NEW');

    await s.approvals.resolveApproval(e1.approvalId!, 'approved');
    await s.approvals.resolveApproval(e2.approvalId!, 'approved');
    expect(await s.promotion.sweep()).toMatchObject({
      new: 1,
      contradicted: 1,
    });

    const active = await s.claims.listClaims({ status: 'active' });
    const contradicted = await s.claims.listClaims({ status: 'contradicted' });
    expect(active).toHaveLength(1);
    expect(active[0]?.object).toBe('Rust');
    expect(contradicted).toHaveLength(1);
    expect(contradicted[0]?.object).toBe('TypeScript');
    expect(contradicted[0]?.evidence).toHaveLength(1);
    const done = await s.journal.getEntry(e2.id);
    expect(done?.detail).toContain(`contradicts:${contradicted[0].id}`);
  });

  it('denies cleanly: no claim, no retry', async () => {
    const s = setup();
    const [saved] = await save(s, [candidate('s1')]);
    const [entry] = await s.promotion.proposeCandidates([saved]);

    await s.approvals.resolveApproval(entry.approvalId!, 'rejected');
    expect(await s.promotion.sweep()).toMatchObject({ denied: 1 });
    expect(await s.claims.listClaims()).toHaveLength(0);
    // Second sweep: terminal, untouched.
    expect(await s.promotion.sweep()).toMatchObject({ denied: 0 });
  });

  it('executes exactly once across repeated calls', async () => {
    const s = setup();
    const [saved] = await save(s, [candidate('s1')]);
    const [entry] = await s.promotion.proposeCandidates([saved]);
    await s.approvals.resolveApproval(entry.approvalId!, 'approved');

    const first = await s.promotion.executeEntry(entry.id);
    const second = await s.promotion.executeEntry(entry.id);
    expect(first.outcome).toBe('new');
    expect(second.outcome).toBe('skipped');
    expect(await s.claims.listClaims()).toHaveLength(1);
  });

  it('fails visibly on missing candidates and unknown origin', async () => {
    const s = setup();
    const [saved] = await save(s, [candidate('s1')]);
    const [entry] = await s.promotion.proposeCandidates([saved]);

    // Candidate deleted out from under the proposal: abort, never invent.
    s.db.connection
      .prepare('DELETE FROM memory_candidates WHERE id = ?')
      .run(saved.id);
    await s.approvals.resolveApproval(entry.approvalId!, 'approved');
    const missing = await s.promotion.executeEntry(entry.id);
    expect(missing.outcome).toBe('failed');
    expect(missing.entry?.detail).toContain('missing_candidate');

    const [legacy] = await save(s, [
      candidate('s1', 'teal', {
        sourceRole: 'unknown',
        source: { sessionId: 's1', messageId: 1, role: 'unknown' },
      }),
    ]);
    const [legacyEntry] = await s.promotion.proposeCandidates([legacy]);
    await s.approvals.resolveApproval(legacyEntry.approvalId!, 'approved');
    const parked = await s.promotion.executeEntry(legacyEntry.id);
    expect(parked.outcome).toBe('failed');
    expect(parked.entry?.detail).toContain('unknown_origin');
    expect(await s.claims.listClaims()).toHaveLength(0);
  });

  it('replays interrupted rows on startup', async () => {
    const s = setup();
    const [saved] = await save(s, [candidate('s1')]);
    const [entry] = await s.promotion.proposeCandidates([saved]);
    await s.journal.setState(entry.id, 'promoting');

    await s.promotion.onModuleInit();
    expect((await s.journal.getEntry(entry.id))?.state).toBe('proposed');
  });

  it('never throws from proposal; a failing approval path logs and skips', async () => {
    const s = setup();
    const failing = {
      create: () => Promise.reject(new Error('sessions down')),
    } as unknown as ApprovalService;
    const promotion = new PromotionService(
      testConfig(join(dir, 'memories.sqlite'), dir),
      s.candidates,
      s.claims,
      s.journal,
      failing,
      s.approvals,
      {
        indexClaim: jest.fn(() => Promise.resolve()),
        searchSimilar: jest.fn(() => Promise.resolve([])),
        status: jest.fn(() => Promise.resolve({ enabled: false })),
      },
      new NoopPublisher(),
      s.prospective,
    );
    const [saved] = await save(s, [candidate('s1')]);
    await expect(promotion.proposeCandidates([saved])).resolves.toHaveLength(0);
  });

  it('lists journal rows by state with approval status and pre-limit total', async () => {
    const s = setup();
    const [saved] = await save(s, [candidate('s1')]);
    const [entry] = await s.promotion.proposeCandidates([saved]);

    const open = await s.promotion.listByStates(['proposed', 'promoting'], 200);
    expect(open.total).toBe(1);
    expect(open.promotions).toHaveLength(1);
    expect(open.promotions[0]).toMatchObject({
      id: entry?.id,
      approvalStatus: 'pending',
    });

    // Terminal rows are invisible to listPending but listed here.
    await s.approvals.resolveApproval(entry.approvalId!, 'rejected');
    await s.promotion.sweep();
    expect(await s.promotion.listPending()).toHaveLength(0);

    const denied = await s.promotion.listByStates(['denied'], 200);
    expect(denied.total).toBe(1);
    expect(denied.promotions[0]).toMatchObject({
      id: entry?.id,
      state: 'denied',
      approvalStatus: 'rejected',
    });

    const page = await s.promotion.listByStates(
      ['proposed', 'promoting', 'committed', 'denied', 'failed'],
      1,
    );
    expect(page.total).toBe(1);
    expect(page.promotions).toHaveLength(1);

    // Auto-promoted rows carry a null approval status (own database:
    // the s1 session row already exists in this fixture's session db).
    const autoDir = mkdtempSync(join(tmpdir(), 'icos-promo-auto-'));
    const autoConfig = testConfig(join(autoDir, 'memories.sqlite'), autoDir, {
      memoryPromotionAuto: true,
      memoryPromotionAutoKinds: ['fact'],
    });
    const autoService = new MemoryDatabaseService(autoConfig);
    autoService.onModuleInit();
    services.push(autoService);
    const autoSessionService = new SessionDatabaseService(autoConfig);
    autoSessionService.onModuleInit();
    services.push(autoSessionService);
    autoSessionService.connection
      .prepare(
        'INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)',
      )
      .run('s1', 't', 't');
    const approvalService = {
      create: (input: {
        sessionId: string;
        action: string;
        description?: string;
      }) => s.approvals.createApproval(input),
    } as unknown as ApprovalService;
    const autoPromotion = new PromotionService(
      autoConfig,
      new SqliteMemoryCandidateRepository(autoService),
      new SqliteClaimRepository(autoService),
      new SqlitePromotionJournalRepository(autoService),
      approvalService,
      new SqliteApprovalRepository(autoSessionService),
      {
        indexClaim: jest.fn(() => Promise.resolve()),
        searchSimilar: jest.fn(() => Promise.resolve([])),
        status: jest.fn(() => Promise.resolve({ enabled: false })),
      },
      new NoopPublisher(),
      new SqliteProspectiveItemRepository(autoService),
    );
    const [autoSaved] = await new SqliteMemoryCandidateRepository(
      autoService,
    ).saveCandidates([
      candidate('s1', 'teal', {
        kind: 'fact',
        subject: 'user',
        predicate: 'likes',
      }),
    ]);
    await autoPromotion.proposeCandidates([autoSaved]);
    const committed = await autoPromotion.listByStates(['committed'], 200);
    expect(committed.total).toBe(1);
    expect(committed.promotions[0]?.approvalStatus).toBeNull();
    rmSync(autoDir, { recursive: true, force: true });
  });

  it('emits promotion.proposed globally (no session room) so every tab refreshes', async () => {
    const s = setup();
    const seen: RealtimeEvent[] = [];
    const probe = new (class extends NoopPublisher {
      override publish(event: RealtimeEvent): void {
        seen.push(event);
      }
    })();
    const probing = new PromotionService(
      testConfig(join(dir, 'memories.sqlite'), dir),
      s.candidates,
      s.claims,
      s.journal,
      {
        create: (input: {
          sessionId: string;
          action: string;
          description?: string;
        }) => s.approvals.createApproval(input),
      } as unknown as ApprovalService,
      s.approvals,
      {
        indexClaim: jest.fn(() => Promise.resolve()),
        searchSimilar: jest.fn(() => Promise.resolve([])),
        status: jest.fn(() => Promise.resolve({ enabled: false })),
      },
      probe,
      s.prospective,
    );
    const [saved] = await save(s, [candidate('s1')]);
    await probing.proposeCandidates([saved]);
    const proposed = seen.find((e) => e.type === 'promotion.proposed');
    expect(proposed).toBeDefined();
    // Global fanout: no sessionId, so the gateway delivers to every socket.
    expect(proposed?.sessionId).toBeUndefined();
    expect(proposed?.payload?.['journalId']).toBeDefined();
  });

  it('contradicts a same-triple negation instead of reinforcing', async () => {
    const s = setup();
    const [affirmed] = await save(s, [candidate('s1', 'TypeScript')]);
    const [e1] = await s.promotion.proposeCandidates([affirmed]);
    await s.approvals.resolveApproval(e1.approvalId!, 'approved');
    expect(await s.promotion.sweep()).toMatchObject({ new: 1 });

    const [denial] = await save(s, [
      candidate('s1', 'TypeScript', { negated: true, confidence: 0.85 }),
    ]);
    const [e2] = await s.promotion.proposeCandidates([denial]);
    expect(e2?.operation).toBe('CONTRADICT');
    const approval = await s.approvals.getApproval(e2.approvalId!);
    expect(approval?.description).toContain('negated');

    await s.approvals.resolveApproval(e2.approvalId!, 'approved');
    expect(await s.promotion.sweep()).toMatchObject({ contradicted: 1 });

    const active = await s.claims.listClaims({ status: 'active' });
    const contradicted = await s.claims.listClaims({
      status: 'contradicted',
    });
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ object: 'TypeScript', negated: true });
    expect(contradicted).toHaveLength(1);
    expect(contradicted[0]).toMatchObject({
      object: 'TypeScript',
      negated: false,
    });
    const done = await s.journal.getEntry(e2.id);
    expect(done?.operation).toBe('CONTRADICT');
    expect(done?.detail).toContain(`contradicts:${contradicted[0].id}`);
    // Confident loser, first contest: no question parked.
    expect(await s.prospective.listItems()).toHaveLength(0);
  });

  it('reinforces same-marker repeats without forking', async () => {
    const s = setup();
    const [first] = await save(s, [
      candidate('s1', 'TypeScript', { negated: true }),
    ]);
    const [second] = await save(s, [
      candidate('s1', 'TypeScript', { negated: true }),
    ]);

    const [e1] = await s.promotion.proposeCandidates([first]);
    const [e2] = await s.promotion.proposeCandidates([second]);
    await s.approvals.resolveApproval(e1.approvalId!, 'approved');
    await s.approvals.resolveApproval(e2.approvalId!, 'approved');
    expect(await s.promotion.sweep()).toMatchObject({
      new: 1,
      reinforced: 1,
    });

    const claims = await s.claims.listClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ negated: true });
    expect(claims[0]?.evidence).toHaveLength(2);
  });

  it('parks a question when the loser sits below threshold', async () => {
    const s = setup();
    const [weak] = await save(s, [
      candidate('s1', 'TypeScript', { confidence: 0.3 }),
    ]);
    const [strong] = await save(s, [
      candidate('s1', 'Rust', { confidence: 0.9 }),
    ]);

    const [e1] = await s.promotion.proposeCandidates([weak]);
    const [e2] = await s.promotion.proposeCandidates([strong]);
    await s.approvals.resolveApproval(e1.approvalId!, 'approved');
    await s.approvals.resolveApproval(e2.approvalId!, 'approved');
    expect(await s.promotion.sweep()).toMatchObject({ contradicted: 1 });

    const items = await s.prospective.listItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      subject: 'user',
      predicate: 'prefers',
      status: 'open',
      contestCount: 1,
      trigger: 'confidence_drop',
    });
    expect(items[0]?.options).toMatchObject([
      { object: 'TypeScript', origin: 'user', confidence: 0.3 },
      { object: 'Rust', origin: 'user', confidence: 0.9 },
    ]);
    expect(items[0]?.suggestedQuestion).toContain('TypeScript');
    expect(items[0]?.suggestedQuestion).toContain('Rust');
    expect(items[0]?.suggestedQuestion).toContain('origin user');
  });

  it('leaves no question for a confident first contest', async () => {
    const s = setup();
    const [first] = await save(s, [candidate('s1', 'TypeScript')]);
    const [second] = await save(s, [candidate('s1', 'Rust')]);

    const [e1] = await s.promotion.proposeCandidates([first]);
    const [e2] = await s.promotion.proposeCandidates([second]);
    await s.approvals.resolveApproval(e1.approvalId!, 'approved');
    await s.approvals.resolveApproval(e2.approvalId!, 'approved');
    expect(await s.promotion.sweep()).toMatchObject({ contradicted: 1 });
    expect(await s.prospective.listItems()).toHaveLength(0);
  });

  it('parks on repeat contest regardless of confidence, merging further rounds', async () => {
    const s = setup();
    const [a] = await save(s, [candidate('s1', 'TypeScript')]);
    const [b] = await save(s, [candidate('s1', 'Rust')]);
    const [c] = await save(s, [candidate('s1', 'Go')]);
    const [d] = await save(s, [candidate('s1', 'Zig')]);

    const entries = await s.promotion.proposeCandidates([a, b, c, d]);
    for (const entry of entries) {
      await s.approvals.resolveApproval(entry.approvalId!, 'approved');
    }
    expect(await s.promotion.sweep()).toMatchObject({ contradicted: 3 });

    // First contest parked nothing; the second parked; the third merged.
    const items = await s.prospective.listItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      trigger: 'repeated_contest',
      contestCount: 3,
      status: 'open',
    });
    expect(items[0]?.options.map((entry) => entry.object).sort()).toEqual([
      'Go',
      'Rust',
      'TypeScript',
      'Zig',
    ]);
    expect(items[0]?.suggestedQuestion).toContain('Zig');
  });

  it('auto-admits NEW only: reinforce and contradict still need approval', async () => {
    const s = setup({
      memoryPromotionAuto: true,
      memoryPromotionAutoKinds: ['fact'],
    });
    const fact = (
      object: string,
      overrides: Partial<NewMemoryCandidate> = {},
    ): NewMemoryCandidate =>
      candidate('s1', object, {
        kind: 'fact',
        subject: 'user',
        predicate: 'likes',
        ...overrides,
      });
    const [a] = await save(s, [fact('teal')]);
    const [e1] = await s.promotion.proposeCandidates([a]);
    expect(e1?.state).toBe('committed');
    expect(e1?.approvalId).toBeNull();

    // Same triple (REINFORCE) and same pair new object (CONTRADICT):
    // above the NEW-only risk bar, so both park for approval.
    const [b] = await save(s, [fact('teal')]);
    const [c] = await save(s, [fact('azure')]);
    const [e2] = await s.promotion.proposeCandidates([b]);
    const [e3] = await s.promotion.proposeCandidates([c]);
    expect(e2).toMatchObject({ operation: 'REINFORCE', state: 'proposed' });
    expect(e2?.approvalId).toBeDefined();
    expect(e3).toMatchObject({ operation: 'CONTRADICT', state: 'proposed' });
    expect(e3?.approvalId).toBeDefined();
    expect(await s.promotion.sweep()).toMatchObject({
      reinforced: 0,
      contradicted: 0,
      skipped: 2,
    });

    await s.approvals.resolveApproval(e2.approvalId!, 'approved');
    await s.approvals.resolveApproval(e3.approvalId!, 'approved');
    expect(await s.promotion.sweep()).toMatchObject({
      reinforced: 1,
      contradicted: 1,
    });
    // Every claim carries its derivation: no belief without a
    // committed journal row pointing at it.
    for (const claim of await s.claims.listClaims()) {
      const history = await s.journal.listByClaimId(claim.id);
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history.every((row) => row.state === 'committed')).toBe(true);
    }
  });

  it('leaves reserved fields neutral through every M10 path', async () => {
    const s = setup({
      memoryPromotionAuto: true,
      memoryPromotionAutoKinds: ['fact'],
    });
    const [a] = await save(s, [
      candidate('s1', 'teal', {
        kind: 'fact',
        subject: 'user',
        predicate: 'likes',
      }),
    ]);
    const [b] = await save(s, [
      candidate('s1', 'teal', {
        kind: 'fact',
        subject: 'user',
        predicate: 'likes',
      }),
    ]);
    const [c] = await save(s, [
      candidate('s1', 'azure', {
        kind: 'fact',
        subject: 'user',
        predicate: 'likes',
      }),
    ]);
    const [e1] = await s.promotion.proposeCandidates([a]);
    expect(e1?.state).toBe('committed');
    const [e2] = await s.promotion.proposeCandidates([b]);
    const [e3] = await s.promotion.proposeCandidates([c]);
    await s.approvals.resolveApproval(e2.approvalId!, 'approved');
    await s.approvals.resolveApproval(e3.approvalId!, 'approved');
    expect(await s.promotion.sweep()).toMatchObject({
      reinforced: 1,
      contradicted: 1,
    });

    const claims = await s.claims.listClaims();
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      expect(claim.sourceType).toBeNull();
      expect(claim.summary).toBeNull();
      expect(claim.related).toEqual([]);
      expect(claim.accessCount).toBe(0);
      expect(claim.lastAccessedAt).toBeNull();
      expect(claim.activation).toBeNull();
      expect(claim.locked).toBe(false);
      expect(claim.emotional).toBeNull();
    }
  });

  it('keeps agent-mined facts agent-origin end to end', async () => {
    const s = setup();
    const [saved] = await save(s, [
      candidate('s1', 'TypeScript', {
        sourceRole: 'assistant',
        source: { sessionId: 's1', messageId: 1, role: 'assistant' },
      }),
    ]);
    const [entry] = await s.promotion.proposeCandidates([saved]);
    await s.approvals.resolveApproval(entry.approvalId!, 'approved');
    expect(await s.promotion.sweep()).toMatchObject({ new: 1 });

    const claims = await s.claims.listClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      origin: 'agent',
      evidence: [{ candidateId: saved.id, role: 'assistant' }],
    });
  });
});
