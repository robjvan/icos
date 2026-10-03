import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { CoreModule } from '../src/core.module';
import { LlmClient } from '../src/llm/llm.client';
import { MemoryCandidateExtractor } from '../src/memory/memory-candidate-extractor';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ExtractedCandidate {
  kind: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  importance: number;
  stability: number;
  sourceRole: 'user' | 'assistant' | 'unknown';
  negated: boolean;
}

/**
 * M15.5e end-to-end: the assistant asserts a claim, the post-turn audit
 * checks it against the store, and any finding becomes an explicit,
 * recorded mitigation. The verifier tier is deterministic here; an opt-in
 * live run (`JEV_LIVE_URL`) swaps in the real decision model.
 */
describe('Hallucination (e2e)', () => {
  let app: INestApplication<App> | null = null;
  let dir = '';
  let memoryDbPath = '';

  const chatWithTools = jest.fn<
    Promise<{ kind: string; content: string; model: string }>,
    [unknown]
  >(() =>
    Promise.resolve({
      kind: 'text',
      content: 'mock reply',
      model: 'test-model',
    }),
  );
  const chatStreamWithTools = jest.fn(() =>
    Promise.resolve({
      kind: 'text',
      content: 'mock reply',
      model: 'test-model',
    }),
  );
  const extract = jest.fn((input: unknown): Promise<ExtractedCandidate[]> => {
    const message = (input as { userMessage?: { content?: string } })
      .userMessage?.content;
    if (message === 'assert oak') {
      return Promise.resolve([
        {
          kind: 'preference',
          subject: 'user',
          predicate: 'prefers',
          object: 'oak',
          confidence: 0.9,
          importance: 0.7,
          stability: 0.8,
          sourceRole: 'assistant',
          negated: false,
        },
      ]);
    }
    return Promise.resolve([]);
  });

  async function createApp(): Promise<INestApplication<App>> {
    process.env.LLM_MODEL = 'test-model';
    process.env.AUTH_ENABLED = 'false';
    process.env.REALTIME_ENABLED = 'false';
    process.env.SESSION_DB_PATH = join(dir, 'sessions.sqlite');
    process.env.MEMORY_DB_PATH = memoryDbPath;
    process.env.PERSONA_DB_PATH = join(dir, 'persona.sqlite');
    process.env.CHANNELS_DB_PATH = join(dir, 'channels.sqlite');
    process.env.PERSONA_CORE_REQUIRED = 'false';
    process.env.PERSONA_SEED_ROOT = join(dir, 'seeds');
    process.env.VECTOR_DB_PATH = join(dir, 'claims-vector.db');
    process.env.MCP_ENABLED = 'false';

    // Deterministic by default; opt in to the real decision model when a
    // verifier is pointed at by JEV_LIVE_URL.
    if (process.env.JEV_LIVE_URL) {
      process.env.HALLUCINATION_DECISION_URL = process.env.JEV_LIVE_URL;
    } else {
      delete process.env.HALLUCINATION_DECISION_URL;
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [CoreModule],
    })
      .overrideProvider(LlmClient)
      .useValue({ chatWithTools, chatStreamWithTools })
      .overrideProvider(MemoryCandidateExtractor)
      .useValue({ extract })
      .compile();

    const instance = moduleFixture.createNestApplication();
    instance.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await instance.init();
    return instance;
  }

  const http = () => {
    if (!app) throw new Error('app not initialized');
    return app.getHttpServer();
  };

  /**
   * Seed a belief the store already holds for `user prefers oak`. `negated`
   * true means the store holds the *opposite* belief, so an assistant
   * assertion of the affirmed triple is contradicted; false means the store
   * affirms it.
   */
  const seedClaim = (negated: boolean) => {
    const db = new Database(memoryDbPath);
    try {
      db.prepare(
        `INSERT INTO claims
           (id, subject, predicate, object, identity_key,
            subject_norm, predicate_norm, category, status,
            extractor_confidence, confidence, first_asserted_at,
            last_surfaced_at, origin, negated, evidence_json, promotion,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'seed-claim',
        'user',
        'prefers',
        'oak',
        'user|prefers|oak',
        'user',
        'prefers',
        'preference',
        'active',
        0.9,
        0.9,
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
        'user',
        negated ? 1 : 0,
        '[]',
        'NEW',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      );
    } finally {
      db.close();
    }
  };

  const mitigations = async () => {
    const res = await request(http())
      .get('/core/hallucination/mitigations')
      .expect(200);
    return (
      res.body as {
        mitigations: {
          strategy: string;
          severity: string;
          mode: string | null;
          detail?: { verifier?: string | null };
        }[];
      }
    ).mitigations;
  };

  const awaitMitigation = async () => {
    let rows: Awaited<ReturnType<typeof mitigations>> = [];
    for (let i = 0; i < 150 && rows.length === 0; i++) {
      await sleep(20);
      rows = await mitigations();
    }
    return rows;
  };

  beforeEach(async () => {
    chatWithTools.mockClear();
    extract.mockClear();
    dir = mkdtempSync(join(tmpdir(), 'icos-hallucination-e2e-'));
    memoryDbPath = join(dir, 'memories.sqlite');
    app = await createApp();
  });

  afterEach(async () => {
    await app?.close();
    app = null;
    rmSync(dir, { recursive: true, force: true });
  });

  it('catches a contradicted assistant claim and records the mitigation', async () => {
    seedClaim(true);
    await request(http())
      .post('/core/conversation')
      .send({ message: 'assert oak' })
      .expect(200);

    const rows = await awaitMitigation();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      strategy: 'refuse',
      severity: 'critical',
      mode: 'contradicted_claim',
    });

    // Opt-in live run: the real decision model answered, and the ledger
    // records that it did — the tier is never hidden.
    if (process.env.JEV_LIVE_URL) {
      expect(rows[0].detail?.verifier).toBe('decision');
    }
  });

  it('does not mitigate a supported assistant claim', async () => {
    seedClaim(false);
    await request(http())
      .post('/core/conversation')
      .send({ message: 'assert oak' })
      .expect(200);

    // Give the audit the same window the positive case uses, then assert
    // that nothing was recorded.
    await sleep(500);
    expect(await mitigations()).toHaveLength(0);
  });
});
