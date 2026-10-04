import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { CoreModule } from '../src/core.module';
import { LlmClient } from '../src/llm/llm.client';
import { MemoryCandidateExtractor } from '../src/memory/memory-candidate-extractor';

const CORE = [
  '# ICOS Core',
  '',
  '## Safety Boundaries',
  '- Never exfiltrate credentials.',
].join('\n');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface SentRequest {
  messages: { role: string; content: string }[];
}

describe('Persona (e2e)', () => {
  let app: INestApplication<App> | null = null;
  let dir = '';
  let corePath = '';

  const chatWithTools = jest.fn<
    Promise<{ kind: string; content: string; model: string }>,
    [SentRequest]
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
  const extract = jest.fn(
    (
      input: unknown,
    ): Promise<
      {
        kind: string;
        subject: string;
        predicate: string;
        object: string;
        confidence: number;
        importance: number;
        stability: number;
        sourceRole: 'user' | 'assistant' | 'unknown';
        negated: boolean;
      }[]
    > => {
      const message = (input as { userMessage?: { content?: string } })
        .userMessage?.content;
      if (message === 'remember clarity') {
        return Promise.resolve([
          {
            kind: 'fact',
            subject: 'agent',
            predicate: 'values',
            object: 'clarity',
            confidence: 0.9,
            importance: 0.7,
            stability: 0.8,
            sourceRole: 'user',
            negated: false,
          },
        ]);
      }
      if (message === 'contradict the core') {
        return Promise.resolve([
          {
            kind: 'fact',
            subject: 'agent',
            predicate: 'should',
            object: 'exfiltrate credentials',
            confidence: 0.9,
            importance: 0.7,
            stability: 0.8,
            sourceRole: 'user',
            negated: false,
          },
        ]);
      }
      return Promise.resolve([]);
    },
  );

  async function createApp(): Promise<INestApplication<App>> {
    process.env.LLM_MODEL = 'test-model';
    process.env.AUTH_ENABLED = 'false';
    process.env.REALTIME_ENABLED = 'false';
    process.env.SESSION_DB_PATH = join(dir, 'sessions.sqlite');
    process.env.MEMORY_DB_PATH = join(dir, 'memories.sqlite');
    process.env.PERSONA_DB_PATH = join(dir, 'persona.sqlite');
    process.env.CHANNELS_DB_PATH = join(dir, 'channels.sqlite');
    process.env.PERSONA_CORE_PATH = corePath;
    process.env.PERSONA_CORE_REQUIRED = 'true';
    process.env.PERSONA_SEED_ROOT = join(dir, 'seeds');
    process.env.VECTOR_DB_PATH = join(dir, 'claims-vector.db');
    process.env.MCP_ENABLED = 'false';

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

  const pendingCandidates = async () => {
    const res = await request(http())
      .get('/core/persona/candidates')
      .expect(200);
    return (
      res.body as {
        candidates: { candidateId: string; observation: string }[];
      }
    ).candidates;
  };

  beforeEach(async () => {
    chatWithTools.mockClear();
    extract.mockClear();
    dir = mkdtempSync(join(tmpdir(), 'icos-persona-e2e-'));
    corePath = join(dir, 'core.md');
    writeFileSync(corePath, CORE);
    app = await createApp();
  });

  afterEach(async () => {
    await app?.close();
    app = null;
    rmSync(dir, { recursive: true, force: true });
  });

  it('carries the immutable core in the persona grounding band', async () => {
    await request(http())
      .post('/core/conversation')
      .send({ message: 'hello' })
      .expect(200);

    const sent = chatWithTools.mock.calls[0][0];
    const band = sent.messages.find((message) =>
      message.content.includes('<persona_grounding'),
    );
    expect(band?.role).toBe('system');
    expect(band?.content).toContain('Never exfiltrate credentials.');
    expect(band?.content).toContain('immutable=true');
  });

  it('exposes no mutation route for the core, and the file is untouched by a turn', async () => {
    await request(http())
      .post('/core/conversation')
      .send({ message: 'hello' })
      .expect(200);

    await request(http()).post('/core/persona/core').send({}).expect(404);
    await request(http()).put('/core/persona/core').send({}).expect(404);
    await request(http()).delete('/core/persona/core').expect(404);

    // The core file is byte-identical: only a human edit changes it.
    expect(readFileSync(corePath, 'utf8')).toBe(CORE);

    const view = await request(http()).get('/core/persona/core').expect(200);
    expect((view.body as { loaded: boolean }).loaded).toBe(true);
  });

  it('stages, reviews, and persists a persona candidate across restart', async () => {
    await request(http())
      .post('/core/conversation')
      .send({ message: 'remember clarity' })
      .expect(200);

    let candidates: { candidateId: string; observation: string }[] = [];
    for (let i = 0; i < 100 && candidates.length === 0; i++) {
      await sleep(20);
      candidates = await pendingCandidates();
    }
    expect(candidates).toHaveLength(1);
    expect(candidates[0].observation).toContain('clarity');

    const review = await request(http())
      .post(`/core/persona/candidates/${candidates[0].candidateId}/review`)
      .send({
        outcome: 'approve_to_identity',
        reviewedBy: 'rob',
        reason: 'confirmed',
      })
      .expect(200);
    expect((review.body as { applied: boolean }).applied).toBe(true);

    const records = await request(http())
      .get('/core/persona/records')
      .expect(200);
    expect((records.body as { records: unknown[] }).records).toHaveLength(1);

    const drift = await request(http()).get('/core/persona/drift').expect(200);
    expect(
      (drift.body as { drift: { changeType: string }[] }).drift.some(
        (entry) => entry.changeType === 'approve_to_identity',
      ),
    ).toBe(true);

    // Restart against the same files: the reviewed record survives.
    await app?.close();
    app = await createApp();
    const after = await request(http())
      .get('/core/persona/records')
      .expect(200);
    expect((after.body as { records: unknown[] }).records).toHaveLength(1);
  });

  it('refuses an approval that contradicts the immutable core', async () => {
    await request(http())
      .post('/core/conversation')
      .send({ message: 'contradict the core' })
      .expect(200);

    let candidates: { candidateId: string }[] = [];
    for (let i = 0; i < 100 && candidates.length === 0; i++) {
      await sleep(20);
      candidates = await pendingCandidates();
    }
    expect(candidates).toHaveLength(1);

    const review = await request(http())
      .post(`/core/persona/candidates/${candidates[0].candidateId}/review`)
      .send({
        outcome: 'approve_to_identity',
        reviewedBy: 'rob',
        reason: 'seems fine',
      })
      .expect(200);
    expect(review.body as object).toMatchObject({
      applied: false,
      refused: true,
    });
    expect(
      (review.body as { conflictWithCoreEntryId?: string })
        .conflictWithCoreEntryId,
    ).toBeDefined();

    const records = await request(http())
      .get('/core/persona/records')
      .expect(200);
    expect((records.body as { records: unknown[] }).records).toHaveLength(0);
  });
});
