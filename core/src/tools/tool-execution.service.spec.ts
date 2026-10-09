import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ApprovalService } from '../approvals/approval.service';
import type { McpConnectionService } from '../mcp/mcp-connection.service';
import { NoopPublisher } from '../realtime/noop.publisher';
import { SqliteApprovalRepository } from '../approvals/sqlite-approval.repository';
import type { CoreConfig } from '../config';
import { SessionStore } from '../conversation/session.store';
import { ToolOffer } from '../llm/llm.protocol';
import type { LlmResult, LlmToolRequest } from '../llm/llm.protocol';
import { SessionDatabaseService } from '../session/session-database.service';
import { SqliteSessionRepository } from '../session/sqlite-session.repository';
import { ToolRegistry } from './tool-registry';
import { ToolExecutionRepository } from './tool-execution.repository';
import {
  ToolExecutionService,
  type ToolExecutionInput,
} from './tool-execution.service';
import type { ChannelSendPort } from '../channels/channel-send.port';
import { ClarificationService } from '../clarifications/clarification.service';
import { SqliteClarificationRepository } from '../clarifications/sqlite-clarification.repository';
import { SkillService } from '../skills/skill.service';
import type { TodoRepository } from '../session/todo.repository';
import type { Claim } from '../memory/claim';
import type { ClaimRepository } from '../memory/claim.repository';
import type { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import type { RecallResult, RecallService } from '../memory/recall.service';
import type { PersonaRepository } from '../persona/persona.repository';
import type { VisionService } from '../vision/vision.service';
import type { ImageGenService } from '../image/image-gen.service';
import { ProcessRegistry } from '../process/process-registry.service';
import type { DiscordAdminPort } from '../channels/discord-admin.port';
import type { CronService } from '../cron/cron.service';
import { ToolRpcTokens } from './tool-rpc.tokens';

const noopClarifications = {
  create: () => Promise.reject(new Error('clarify unwired')),
  get: () => Promise.reject(new Error('clarify unwired')),
} as unknown as ClarificationService;

function input(): ToolExecutionInput {
  return {
    requestId: 'request-1',
    sessionId: 's1',
    context: [{ role: 'user', content: 'Find teal' }],
    allowedTools: ['session.search', 'session.rename'],
    proposal: {
      kind: 'tool_calls',
      model: 'test',
      content: null,
      toolCalls: [
        {
          id: 'model-id',
          name: 'session.search',
          version: 1,
          rawArguments: '{"query":"teal","limit":1}',
          args: { query: 'teal', limit: 1 },
        },
      ],
    },
  };
}

describe('ToolExecutionService SQLite', () => {
  let dir: string;
  const databases: SessionDatabaseService[] = [];
  const final = jest.fn<Promise<LlmResult>, [LlmToolRequest]>();

  function toolInput(
    requestId: string,
    name: string,
    args: Record<string, unknown>,
  ): ToolExecutionInput {
    const rawArguments = JSON.stringify(args);
    return {
      requestId,
      sessionId: 's1',
      context: [{ role: 'user', content: 'do it' }],
      allowedTools: [name],
      proposal: {
        kind: 'tool_calls',
        model: 'test',
        content: null,
        toolCalls: [
          {
            id: `${requestId}-call`,
            name,
            version: 1,
            rawArguments,
            args,
          },
        ],
      },
    };
  }

  function open(
    channels?: ChannelSendPort,
    searxngBaseUrl?: string,
    skills?: SkillService,
    todos?: TodoRepository,
    memory: {
      claims?: ClaimRepository;
      recall?: RecallService;
      candidates?: MemoryCandidateRepository;
      persona?: PersonaRepository;
    } = {},
    clarifications?: ClarificationService,
    vision?: VisionService,
    imageGen?: ImageGenService,
    processes?: ProcessRegistry,
    discordAdmin?: DiscordAdminPort,
    cron?: CronService,
    rpcTokens?: ToolRpcTokens,
  ) {
    const config = {
      sessionDbPath: join(dir, 'sessions.sqlite'),
      memoryDbPath: join(dir, 'unused.sqlite'),
      maxHistory: 50,
    } as CoreConfig;
    const database = new SessionDatabaseService(config);
    database.onModuleInit();
    databases.push(database);
    const sessions = new SqliteSessionRepository(database);
    const store = new SessionStore(sessions, config);
    const ledger = new ToolExecutionRepository(database);
    const registry = new ToolRegistry();
    const approvals = new SqliteApprovalRepository(database);
    const approvalService = new ApprovalService(
      approvals,
      sessions,
      new NoopPublisher(),
    );
    const clarificationsRepository = new SqliteClarificationRepository(
      database,
    );
    const clarificationsPort: ClarificationService =
      clarifications ??
      new ClarificationService(
        clarificationsRepository,
        sessions,
        new NoopPublisher(),
      );
    const service = new ToolExecutionService(
      ledger,
      store,
      registry,
      {
        chatWithTools: final,
      },
      approvals,
      {
        workspaceRoot: dir,
        ...(searxngBaseUrl !== undefined ? { searxngBaseUrl } : {}),
        rpcBaseUrl: 'http://127.0.0.1:3000',
      },
      undefined,
      approvalService,
      {
        callTool: () => Promise.reject(new Error('mcp unwired')),
      } as unknown as McpConnectionService,
      clarificationsPort,
      channels,
      skills,
      todos,
      memory.claims,
      memory.recall,
      memory.candidates,
      memory.persona,
      vision,
      imageGen,
      processes ?? new ProcessRegistry(),
      discordAdmin,
      cron,
      rpcTokens ?? new ToolRpcTokens(),
    );
    return {
      database,
      sessions,
      store,
      ledger,
      registry,
      service,
      approvals,
      approvalService,
      clarifications: clarificationsRepository,
    };
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-tools-'));
    final.mockReset().mockResolvedValue({
      kind: 'text',
      content: 'Found teal',
      model: 'test',
    });
  });

  afterEach(() => {
    databases.splice(0).forEach((database) => database.onModuleDestroy());
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists scoped real search and final response, delivering each at most once', async () => {
    const { sessions, store, service, ledger } = open();
    await sessions.createSession('s1');
    await sessions.createSession('s2');
    await sessions.appendMessage('s1', { role: 'user', content: 'teal local' });
    await sessions.appendMessage('s2', {
      role: 'user',
      content: 'teal private',
    });
    const search = jest.spyOn(store, 'searchMessages');
    const first = await service.consume(input());
    expect(first.state).toBe('succeeded');
    expect(first.execution).toMatchObject({
      ok: true,
      matches: [{ sessionId: 's1', content: 'teal local' }],
    });
    expect(first.final).toEqual({
      state: 'succeeded',
      result: { kind: 'text', content: 'Found teal', model: 'test' },
    });
    expect(await service.consume(input())).toEqual(first);
    expect(ledger.get('request-1')).toEqual(first);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('teal', { sessionId: 's1', limit: 1 });
    expect(final).toHaveBeenCalledTimes(1);
    expect(await sessions.getMessages('s1')).toHaveLength(1);
  });

  it('reads a workspace file through the generic native path (M17b)', async () => {
    const { sessions, service } = open();
    await sessions.createSession('s1');
    writeFileSync(join(dir, 'note.txt'), 'hello workspace');

    const record = await service.consume({
      requestId: 'req-read',
      sessionId: 's1',
      context: [{ role: 'user', content: 'read it' }],
      allowedTools: ['read_file'],
      proposal: {
        kind: 'tool_calls',
        model: 'test',
        content: null,
        toolCalls: [
          {
            id: 'call-read',
            name: 'read_file',
            version: 1,
            rawArguments: '{"path":"note.txt"}',
            args: { path: 'note.txt' },
          },
        ],
      },
    });

    expect(record.state).toBe('succeeded');
    expect(record.execution).toMatchObject({
      ok: true,
      tool: 'read_file',
      result: { path: 'note.txt', content: 'hello workspace' },
    });
  });

  it('refuses a read_file path outside the workspace (M17b)', async () => {
    const { sessions, service } = open();
    await sessions.createSession('s1');

    const record = await service.consume({
      requestId: 'req-escape',
      sessionId: 's1',
      context: [{ role: 'user', content: 'read it' }],
      allowedTools: ['read_file'],
      proposal: {
        kind: 'tool_calls',
        model: 'test',
        content: null,
        toolCalls: [
          {
            id: 'call-escape',
            name: 'read_file',
            version: 1,
            rawArguments: '{"path":"../outside.txt"}',
            args: { path: '../outside.txt' },
          },
        ],
      },
    });

    expect(record.state).toBe('failed');
    expect(record.execution).toMatchObject({
      ok: false,
      failure: { code: 'tool_failed' },
    });
  });

  it('writes and patches a workspace file through the generic native path (M17b)', async () => {
    const { sessions, service } = open();
    await sessions.createSession('s1');

    const write = await service.consume(
      toolInput('req-write', 'write_file', {
        path: 'sub/a.txt',
        content: 'hello',
      }),
    );
    expect(write.state).toBe('succeeded');
    expect(write.execution).toMatchObject({
      ok: true,
      tool: 'write_file',
      result: { path: 'sub/a.txt', bytes: 5 },
    });
    expect(readFileSync(join(dir, 'sub/a.txt'), 'utf8')).toBe('hello');

    const patch = await service.consume(
      toolInput('req-patch', 'patch', {
        path: 'sub/a.txt',
        oldString: 'hello',
        newString: 'bye',
      }),
    );
    expect(patch.state).toBe('succeeded');
    expect(readFileSync(join(dir, 'sub/a.txt'), 'utf8')).toBe('bye');
  });

  it('fails a patch when the string is absent (M17b)', async () => {
    const { sessions, service } = open();
    await sessions.createSession('s1');
    writeFileSync(join(dir, 'a.txt'), 'hello');

    const record = await service.consume(
      toolInput('req-patch-miss', 'patch', {
        path: 'a.txt',
        oldString: 'nope',
        newString: 'x',
      }),
    );
    expect(record.state).toBe('failed');
    expect(record.execution).toMatchObject({
      ok: false,
      failure: { code: 'tool_failed' },
    });
  });

  it('searches the web through SearXNG (M17b)', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: 'SearXNG',
              url: 'https://searxng.example',
              content: 'meta search',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    try {
      const { sessions, service } = open(
        undefined,
        'http://searxng.local:8080',
      );
      await sessions.createSession('s1');

      const record = await service.consume(
        toolInput('req-web', 'web_search', { query: 'searxng' }),
      );

      expect(record.state).toBe('succeeded');
      expect(record.execution).toMatchObject({
        ok: true,
        tool: 'web_search',
        result: {
          query: 'searxng',
          results: [
            {
              title: 'SearXNG',
              url: 'https://searxng.example',
              snippet: 'meta search',
            },
          ],
        },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0]?.[0] as string).toContain('format=json');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('fails web_search when SearXNG is not configured (M17b)', async () => {
    const { sessions, service } = open();
    await sessions.createSession('s1');

    const record = await service.consume(
      toolInput('req-web-none', 'web_search', { query: 'x' }),
    );

    expect(record.state).toBe('failed');
    expect(record.execution).toMatchObject({
      ok: false,
      failure: { code: 'unavailable' },
    });
  });

  it('extracts readable text from a web page (M17b)', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          '<html><head><style>.x{}</style><script>bad()</script></head>' +
            '<body><h1>Title</h1><p>Hello &amp; welcome</p></body></html>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        ),
      );
    try {
      const { sessions, service } = open(
        undefined,
        'http://searxng.local:8080',
      );
      await sessions.createSession('s1');

      const record = await service.consume(
        toolInput('req-extract', 'web_extract', {
          url: 'https://example.com/page',
        }),
      );

      expect(record.state).toBe('succeeded');
      expect(record.execution).toMatchObject({
        ok: true,
        tool: 'web_extract',
        result: {
          url: 'https://example.com/page',
          text: 'Title Hello & welcome',
        },
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('lists and views skills through the generic native path (M17b)', async () => {
    const skills = {
      listDescriptors: () => [
        { name: 'demo', description: 'A demo skill', version: '1.0.0' },
      ],
      loadBody: (name: string) =>
        Promise.resolve({
          name,
          description: 'A demo skill',
          version: '1.0.0',
          body: 'Do the demo.',
          bodyChars: 12,
        }),
    } as unknown as SkillService;
    const { sessions, service } = open(undefined, undefined, skills);
    await sessions.createSession('s1');

    const list = await service.consume(
      toolInput('req-skills', 'skills_list', {}),
    );
    expect(list.state).toBe('succeeded');
    expect(list.execution).toMatchObject({
      ok: true,
      tool: 'skills_list',
      result: { skills: [{ name: 'demo', description: 'A demo skill' }] },
    });

    const view = await service.consume(
      toolInput('req-skill-view', 'skill_view', { name: 'demo' }),
    );
    expect(view.state).toBe('succeeded');
    expect(view.execution).toMatchObject({
      ok: true,
      tool: 'skill_view',
      result: { name: 'demo', body: 'Do the demo.' },
    });
  });

  it('manages todos through the generic native path (M17b)', async () => {
    const todos = {
      list: () => Promise.resolve([]),
      add: (sessionId: string, text: string) =>
        Promise.resolve({
          id: 't1',
          sessionId,
          text,
          status: 'open',
          createdAt: 'now',
          updatedAt: 'now',
        }),
      complete: (sessionId: string, id: string) =>
        Promise.resolve({
          id,
          sessionId,
          text: 'do it',
          status: 'done',
          createdAt: 'now',
          updatedAt: 'now',
        }),
      remove: () => Promise.resolve(true),
      clear: () => Promise.resolve(0),
    } as unknown as TodoRepository;
    const { sessions, service } = open(undefined, undefined, undefined, todos);
    await sessions.createSession('s1');

    const add = await service.consume(
      toolInput('req-todo-add', 'todo', { action: 'add', text: 'do it' }),
    );
    expect(add.state).toBe('succeeded');
    expect(add.execution).toMatchObject({
      ok: true,
      tool: 'todo',
      result: { todo: { id: 't1', text: 'do it', status: 'open' } },
    });

    const done = await service.consume(
      toolInput('req-todo-done', 'todo', { action: 'complete', id: 't1' }),
    );
    expect(done.state).toBe('succeeded');
    expect(done.execution).toMatchObject({
      ok: true,
      tool: 'todo',
      result: { todo: { id: 't1', status: 'done' } },
    });
  });

  it('inspects the memory layers through the generic native path (M17b)', async () => {
    const claim = {
      id: 'c1',
      subject: 'user',
      predicate: 'likes',
      object: 'cashmere sweaters',
      status: 'active',
      category: 'preference',
      origin: 'user',
      confidence: 0.8,
      negated: false,
      entities: ['cashmere sweaters'],
    } as unknown as Claim;
    const otherClaim = {
      ...claim,
      id: 'c2',
      predicate: 'dislikes',
      object: 'wool',
      entities: ['wool'],
    };
    const claims = {
      listClaims: () => Promise.resolve([claim, otherClaim]),
      getClaim: (id: string) => Promise.resolve(id === 'c1' ? claim : null),
    } as unknown as ClaimRepository;
    const recall = {
      recall: () =>
        Promise.resolve({
          query: { text: 'sweaters', tokens: ['sweaters'] },
          lexical: {
            surface: 'lexical',
            available: true,
            hits: [{ claimId: 'c1', score: 0.9, surface: 'lexical' }],
          },
          semantic: {
            surface: 'semantic',
            available: false,
            reason: 'down',
            hits: [],
          },
          associative: { surface: 'associative', available: true, hits: [] },
          kb: { available: false, hits: [] },
        } as unknown as RecallResult),
    } as unknown as RecallService;
    const candidates = {
      listCandidates: () =>
        Promise.resolve([
          {
            id: 'm1',
            kind: 'preference',
            subject: 'user',
            predicate: 'likes',
            object: 'cashmere',
            confidence: 0.7,
            importance: 0.5,
            sourceRole: 'user',
            negated: false,
            extractedAt: 'now',
            source: { sessionId: 's1', messageId: 1, role: 'user' },
          },
        ]),
    } as unknown as MemoryCandidateRepository;
    const persona = {
      listRecords: () =>
        Promise.resolve([
          {
            recordId: 'r1',
            category: 'identity',
            content: 'goes by Rob',
            confidence: 0.9,
            sensitivity: 'normal',
            protected: false,
          },
        ]),
      listUserFacts: () =>
        Promise.resolve([
          { memoryId: 'f1', content: 'middle name is James', confidence: 0.9 },
        ]),
      getRelationship: () =>
        Promise.resolve({
          trustLevel: 0.6,
          emotionalTemperature: 0.4,
          activeNicknames: ['Rob'],
          recentDevelopments: [],
        }),
      getCoreState: () =>
        Promise.resolve({
          path: '/core.md',
          hash: 'abc',
          entryCount: 11,
          loaded: true,
          reason: null,
          updatedAt: 'now',
        }),
    } as unknown as PersonaRepository;
    const { sessions, service } = open(
      undefined,
      undefined,
      undefined,
      undefined,
      { claims, recall, candidates, persona },
    );
    await sessions.createSession('s1');

    const beliefs = await service.consume(
      toolInput('req-mem-beliefs', 'memory', {
        layer: 'beliefs',
        query: 'wool',
      }),
    );
    expect(beliefs.state).toBe('succeeded');
    expect(beliefs.execution).toMatchObject({
      ok: true,
      tool: 'memory',
      result: { beliefs: [{ id: 'c2' }] },
    });

    const ranked = await service.consume(
      toolInput('req-mem-recall', 'memory', {
        layer: 'recall',
        query: 'sweaters',
      }),
    );
    expect(ranked.state).toBe('succeeded');
    expect(ranked.execution).toMatchObject({
      ok: true,
      tool: 'memory',
      result: { beliefs: [{ id: 'c1', score: 0.9 }] },
    });

    const personaResult = await service.consume(
      toolInput('req-mem-persona', 'memory', { layer: 'persona' }),
    );
    expect(personaResult.state).toBe('succeeded');
    expect(personaResult.execution).toMatchObject({
      ok: true,
      tool: 'memory',
      result: {
        core: { loaded: true, entryCount: 11 },
        records: [{ id: 'r1' }],
        userFacts: [{ id: 'f1' }],
        relationship: { trustLevel: 0.6 },
      },
    });

    const candidateResult = await service.consume(
      toolInput('req-mem-candidates', 'memory', { layer: 'candidates' }),
    );
    expect(candidateResult.state).toBe('succeeded');
    expect(candidateResult.execution).toMatchObject({
      ok: true,
      tool: 'memory',
      result: { candidates: [{ id: 'm1', kind: 'preference' }] },
    });
  });

  it('parks on a clarification and resumes with the answer (M17b)', async () => {
    const { sessions, service, clarifications } = open();
    await sessions.createSession('s1');

    const parked = await service.consume(
      toolInput('req-clarify', 'clarify', {
        question: 'Which one?',
        options: ['a', 'b'],
      }),
    );
    expect(parked.state).toBe('awaiting_clarification');
    const clarificationId = parked.clarificationId;
    expect(clarificationId).toBeDefined();

    // Polling before an answer keeps the invocation parked.
    const polled = await service.resume('req-clarify', 's1');
    expect(polled.state).toBe('awaiting_clarification');

    await clarifications.answerClarification(clarificationId as string, 'a');
    const answered = await service.resume('req-clarify', 's1', {
      skipFinal: true,
    });
    expect(answered.state).toBe('succeeded');
    expect(answered.execution).toMatchObject({
      ok: true,
      tool: 'clarify',
      result: {
        question: 'Which one?',
        answer: 'a',
        options: ['a', 'b'],
      },
    });
  });

  it('analyzes a workspace image through the vision role (M17b.8)', async () => {
    type VisionInput = { prompt: string; dataUrl: string };
    const analyze = jest.fn<
      Promise<{ text: string; model: string }>,
      [VisionInput]
    >(() => Promise.resolve({ text: 'A teal square.', model: 'v' }));
    const vision = { analyze } as unknown as VisionService;
    const { sessions, service } = open(
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      undefined,
      vision,
    );
    await sessions.createSession('s1');
    writeFileSync(join(dir, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = await service.consume(
      toolInput('req-vision', 'vision_analyze', {
        path: 'pic.png',
        prompt: 'What?',
      }),
    );
    expect(result.state).toBe('succeeded');
    expect(result.execution).toMatchObject({
      ok: true,
      tool: 'vision_analyze',
      result: {
        path: 'pic.png',
        mime: 'image/png',
        model: 'v',
        text: 'A teal square.',
      },
    });
    expect(analyze).toHaveBeenCalledTimes(1);
    const call = analyze.mock.calls[0][0];
    expect(call.prompt).toBe('What?');
    expect(call.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('rejects an unsupported image type (M17b.8)', async () => {
    const analyze = jest.fn();
    const vision = { analyze } as unknown as VisionService;
    const { sessions, service } = open(
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      undefined,
      vision,
    );
    await sessions.createSession('s1');
    writeFileSync(join(dir, 'notes.txt'), 'hello');

    const result = await service.consume(
      toolInput('req-vision-bad', 'vision_analyze', { path: 'notes.txt' }),
    );
    expect(result.state).toBe('failed');
    expect(result.execution).toMatchObject({
      ok: false,
      failure: { code: 'tool_failed' },
    });
    expect(analyze).not.toHaveBeenCalled();
  });

  it('generates an image through the image backend (M17b.9)', async () => {
    const generate = jest.fn(() =>
      Promise.resolve({
        path: '/w/generated/x.png',
        provider: 'openai',
        model: 'gpt-image-1',
        bytes: 4,
      }),
    );
    const imageGen = { generate } as unknown as ImageGenService;
    const { sessions, service } = open(
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      undefined,
      undefined,
      imageGen,
    );
    await sessions.createSession('s1');

    const result = await service.consume(
      toolInput('req-img', 'image_generate', {
        prompt: 'a teal square',
        size: '512x512',
      }),
    );
    expect(result.state).toBe('succeeded');
    expect(result.execution).toMatchObject({
      ok: true,
      tool: 'image_generate',
      result: {
        path: '/w/generated/x.png',
        provider: 'openai',
        model: 'gpt-image-1',
        bytes: 4,
      },
    });
    expect(generate).toHaveBeenCalledWith({
      prompt: 'a teal square',
      size: '512x512',
    });
  });

  it('reports image_generate unavailable when unconfigured (M17b.9)', async () => {
    const { sessions, service } = open();
    await sessions.createSession('s1');

    const result = await service.consume(
      toolInput('req-img-none', 'image_generate', { prompt: 'x' }),
    );
    expect(result.state).toBe('failed');
    expect(result.execution).toMatchObject({
      ok: false,
      failure: { code: 'unavailable' },
    });
  });

  it('runs an approved terminal command in the workspace jail (M17c)', async () => {
    const { sessions, service, approvalService } = open();
    await sessions.createSession('s1');

    const parked = await service.consume(
      toolInput('req-term', 'terminal', { command: 'echo hello' }),
    );
    expect(parked.state).toBe('awaiting_approval');
    expect(parked.approvalId).toBeTruthy();
    expect(parked.execution).toBeNull();

    await approvalService.approve(parked.approvalId as string, 's1');
    const done = await service.resume('req-term', 's1', { skipFinal: true });
    expect(done.state).toBe('succeeded');
    expect(done.execution).toMatchObject({
      ok: true,
      tool: 'terminal',
      result: { exitCode: 0 },
    });
    const outcome = done.execution as unknown as {
      result: { stdout: string };
    };
    expect(outcome.result.stdout).toContain('hello');
  });

  it('rejects a terminal cwd outside the workspace (M17c)', async () => {
    const { sessions, service, approvalService } = open();
    await sessions.createSession('s1');

    const parked = await service.consume(
      toolInput('req-term-esc', 'terminal', {
        command: 'pwd',
        cwd: '../..',
      }),
    );
    await approvalService.approve(parked.approvalId as string, 's1');
    const done = await service.resume('req-term-esc', 's1', {
      skipFinal: true,
    });
    expect(done.state).toBe('failed');
    expect(done.execution).toMatchObject({
      ok: false,
      failure: { code: 'tool_failed' },
    });
  });

  it('starts a background process after approval and manages it (M17c.2)', async () => {
    const { sessions, service, approvalService } = open();
    await sessions.createSession('s1');

    const parked = await service.consume(
      toolInput('req-ps', 'process_start', { command: 'sleep 30' }),
    );
    expect(parked.state).toBe('awaiting_approval');
    await approvalService.approve(parked.approvalId as string, 's1');
    const started = await service.resume('req-ps', 's1', { skipFinal: true });
    expect(started.state).toBe('succeeded');
    const startedResult = started.execution as unknown as {
      result: { id: string };
    };
    const id = startedResult.result.id;
    expect(id).toBeTruthy();

    const listed = await service.consume(
      toolInput('req-ps-list', 'process_manage', { action: 'list' }),
    );
    expect(listed.state).toBe('succeeded');
    expect(listed.execution).toMatchObject({
      ok: true,
      tool: 'process_manage',
    });

    const killed = await service.consume(
      toolInput('req-ps-kill', 'process_manage', { action: 'kill', id }),
    );
    expect(killed.state).toBe('succeeded');
    expect(killed.execution).toMatchObject({
      ok: true,
      tool: 'process_manage',
      result: { killed: true },
    });
  });

  it('creates, updates, and deletes a skill through skill_manage (M17c.3)', async () => {
    const skillsDir = mkdtempSync(join(tmpdir(), 'icos-skills-'));
    const skills = new SkillService({
      skillsEnabled: true,
      skillsDirPath: skillsDir,
      skillsMaxBodyChars: 64 * 1024,
    } as unknown as CoreConfig);
    await skills.onModuleInit();
    const { sessions, service } = open(undefined, undefined, skills);
    await sessions.createSession('s1');

    const created = await service.consume(
      toolInput('req-skill-create', 'skill_manage', {
        action: 'create',
        name: 'demo',
        description: 'Demo.',
        body: 'Step.',
      }),
    );
    expect(created.state).toBe('succeeded');
    expect(created.execution).toMatchObject({
      ok: true,
      tool: 'skill_manage',
      result: { action: 'create', skill: { name: 'demo' } },
    });

    const updated = await service.consume(
      toolInput('req-skill-update', 'skill_manage', {
        action: 'update',
        name: 'demo',
        description: 'Updated.',
        body: 'Step two.',
      }),
    );
    expect(updated.state).toBe('succeeded');

    const deleted = await service.consume(
      toolInput('req-skill-delete', 'skill_manage', {
        action: 'delete',
        name: 'demo',
      }),
    );
    expect(deleted.state).toBe('succeeded');
    expect(deleted.execution).toMatchObject({
      ok: true,
      tool: 'skill_manage',
      result: { deleted: true },
    });
    expect(skills.listDescriptors().map((d) => d.name)).not.toContain('demo');
    rmSync(skillsDir, { recursive: true, force: true });
  });

  it('reads Discord info and runs approved moderation (M17c.4)', async () => {
    const run = jest.fn((request: { action: string }) =>
      Promise.resolve({ action: request.action, ok: true }),
    );
    const discordAdmin = { run } as unknown as DiscordAdminPort;
    const { sessions, service, approvalService } = open(
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      discordAdmin,
    );
    await sessions.createSession('s1');

    const info = await service.consume(
      toolInput('req-dc-info', 'discord', { action: 'server_info' }),
    );
    expect(info.state).toBe('succeeded');
    expect(info.execution).toMatchObject({
      ok: true,
      tool: 'discord',
      result: { action: 'server_info' },
    });

    const parked = await service.consume(
      toolInput('req-dc-timeout', 'discord_admin', {
        action: 'timeout_member',
        user_id: 'u1',
        duration_ms: 60000,
        reason: 'spam',
      }),
    );
    expect(parked.state).toBe('awaiting_approval');
    await approvalService.approve(parked.approvalId as string, 's1');
    const done = await service.resume('req-dc-timeout', 's1', {
      skipFinal: true,
    });
    expect(done.state).toBe('succeeded');
    expect(done.execution).toMatchObject({
      ok: true,
      tool: 'discord_admin',
      result: { action: 'timeout_member', ok: true },
    });
    expect(run).toHaveBeenCalledWith({
      action: 'timeout_member',
      userId: 'u1',
      durationMs: 60000,
      reason: 'spam',
    });
  });

  it('manages cron jobs through cronjob_manage (M17d)', async () => {
    const job = {
      id: 'j1',
      name: 'morning',
      schedule: '0 9 * * *',
      prompt: 'p',
      sessionId: 's1',
      deliver: null,
      enabled: true,
      lastRunAt: null,
      nextRunAt: '2026-10-10T09:00:00.000Z',
      createdAt: 't',
      updatedAt: 't',
    };
    const cronCreate = jest.fn(() => Promise.resolve(job));
    const cron = {
      list: jest.fn(() => Promise.resolve([job])),
      create: cronCreate,
      pause: jest.fn(() => Promise.resolve({ ...job, enabled: false })),
      resume: jest.fn(() => Promise.resolve(job)),
      remove: jest.fn(() => Promise.resolve()),
      runNow: jest.fn(() => Promise.resolve({ reply: 'ok', delivered: false })),
    } as unknown as CronService;
    const { sessions, service } = open(
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      cron,
    );
    await sessions.createSession('s1');

    const list = await service.consume(
      toolInput('req-cron-list', 'cronjob_manage', { action: 'list' }),
    );
    expect(list.state).toBe('succeeded');
    expect(list.execution).toMatchObject({
      ok: true,
      tool: 'cronjob_manage',
      result: { jobs: [{ id: 'j1' }] },
    });

    const create = await service.consume(
      toolInput('req-cron-create', 'cronjob_manage', {
        action: 'create',
        name: 'morning',
        schedule: '0 9 * * *',
        prompt: 'p',
      }),
    );
    expect(create.state).toBe('succeeded');
    expect(cronCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'morning',
        schedule: '0 9 * * *',
        prompt: 'p',
        sessionId: 's1',
      }),
    );

    const remove = await service.consume(
      toolInput('req-cron-remove', 'cronjob_manage', {
        action: 'remove',
        id: 'j1',
      }),
    );
    expect(remove.state).toBe('succeeded');
    expect(remove.execution).toMatchObject({
      ok: true,
      result: { removed: true },
    });
  });

  it('runs an approved script through execute_code (M17d.2)', async () => {
    const { sessions, service, approvalService } = open();
    await sessions.createSession('s1');

    const parked = await service.consume(
      toolInput('req-code', 'execute_code', {
        language: 'javascript',
        code: 'console.log("hi from code")',
      }),
    );
    expect(parked.state).toBe('awaiting_approval');
    await approvalService.approve(parked.approvalId as string, 's1');
    const done = await service.resume('req-code', 's1', { skipFinal: true });
    expect(done.state).toBe('succeeded');
    expect(done.execution).toMatchObject({
      ok: true,
      tool: 'execute_code',
      result: { language: 'javascript', exitCode: 0 },
    });
    const outcome = done.execution as unknown as {
      result: { stdout: string };
    };
    expect(outcome.result.stdout).toContain('hi from code');
  });

  it('defers the final call when skipFinal is set, then finalizes on demand', async () => {
    const { sessions, service } = open();
    await sessions.createSession('s1');
    await sessions.appendMessage('s1', { role: 'user', content: 'teal local' });

    const stepped = await service.consume(input(), { skipFinal: true });
    expect(stepped.state).toBe('succeeded');
    expect(stepped.execution).toMatchObject({ ok: true });
    expect(stepped.final.state).toBe('pending');
    expect(final).not.toHaveBeenCalled();

    const finished = await service.consume(input());
    expect(finished.final).toEqual({
      state: 'succeeded',
      result: { kind: 'text', content: 'Found teal', model: 'test' },
    });
    expect(final).toHaveBeenCalledTimes(1);
  });

  it('competing connections cannot rerun an in-flight handler or final attempt', async () => {
    const first = open();
    const second = open();
    await first.sessions.createSession('s1');
    let releaseSearch!: (value: []) => void;
    const search = jest.spyOn(first.store, 'searchMessages').mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseSearch = resolve;
        }),
    );
    const otherSearch = jest.spyOn(second.store, 'searchMessages');
    let releaseFinal!: (value: LlmResult) => void;
    final.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseFinal = resolve;
        }),
    );
    const running = first.service.consume(input());
    expect((await second.service.consume(input())).state).toBe('executing');
    releaseSearch([]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect((await second.service.consume(input())).final.state).toBe('claimed');
    releaseFinal({ kind: 'text', content: 'done', model: 'test' });
    const completed = await running;
    expect(await second.service.consume(input())).toEqual(completed);
    expect(search).toHaveBeenCalledTimes(1);
    expect(otherSearch).not.toHaveBeenCalled();
    expect(final).toHaveBeenCalledTimes(1);
  });

  it.each(['context', 'session', 'proposal', 'policy'] as const)(
    'conflicts on changed %s without replacement',
    async (change) => {
      const { service, sessions, ledger } = open();
      await sessions.createSession('s1');
      await sessions.createSession('s2');
      const prior = await service.consume(input());
      const changed = input();
      if (change === 'context')
        changed.context = [{ role: 'user', content: 'different' }];
      if (change === 'session') changed.sessionId = 's2';
      if (change === 'proposal')
        changed.proposal = {
          kind: 'text',
          content: 'different',
          model: 'test',
        };
      if (change === 'policy') changed.allowedTools = [];
      await expect(service.consume(changed)).rejects.toThrow(
        'request_conflict',
      );
      expect(ledger.get('request-1')).toEqual(prior);
      expect(final).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    'multi',
    'zero',
    'unknown',
    'disallowed',
    'args',
    'raw',
    'json',
    'version',
  ] as const)('durably rejects %s before effects', async (bad) => {
    const { service, sessions, store, database } = open();
    await sessions.createSession('s1');
    const search = jest.spyOn(store, 'searchMessages');
    const proposal = input();
    if (proposal.proposal.kind !== 'tool_calls') throw new Error('fixture');
    const call = proposal.proposal.toolCalls[0];
    if (bad === 'multi')
      proposal.proposal = {
        ...proposal.proposal,
        toolCalls: [call, { ...call, id: 'second' }],
      };
    if (bad === 'zero')
      proposal.proposal = { ...proposal.proposal, toolCalls: [] };
    if (bad === 'unknown') Object.assign(call, { name: 'session.delete' });
    if (bad === 'version') Object.assign(call, { version: 2 });
    if (bad === 'disallowed') proposal.allowedTools = [];
    if (bad === 'args')
      Object.assign(call, {
        args: { query: 'teal', sessionId: 's2' },
        rawArguments: '{"query":"teal","sessionId":"s2"}',
      });
    if (bad === 'raw')
      Object.assign(call, { rawArguments: '{"query":"different","limit":1}' });
    if (bad === 'json') Object.assign(call, { rawArguments: '{' });
    const result = await service.consume(proposal);
    expect(result.state).toBe('invalid');
    expect(result.validation.ok).toBe(false);
    if (result.validation.ok) throw new Error('expected invalid proposal');
    expect(typeof result.validation.failure.code).toBe('string');
    expect(await service.consume(proposal)).toEqual(result);
    expect(search).not.toHaveBeenCalled();
    expect(final).not.toHaveBeenCalled();
    expect(
      database.connection.prepare('SELECT * FROM approvals').all(),
    ).toEqual([]);
  });

  it('returns completed duplicates without consulting changed validation code', async () => {
    const { service, sessions, registry } = open();
    await sessions.createSession('s1');
    const result = await service.consume(input());
    jest.spyOn(registry, 'validate').mockImplementation(() => {
      throw new Error('changed registry');
    });
    expect(await service.consume(input())).toEqual(result);
    expect(final).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    { kind: 'tool_calls', model: 'test', content: null, toolCalls: null },
    { kind: 'tool_calls', model: 'test', content: null, toolCalls: {} },
  ])('durably rejects malformed completed proposals: %j', async (malformed) => {
    const { service, sessions, store, ledger } = open();
    await sessions.createSession('s1');
    const search = jest.spyOn(store, 'searchMessages');
    const proposal = {
      ...input(),
      proposal: malformed as unknown as LlmResult,
    };
    const result = await service.consume(proposal);
    expect(result.state).toBe('invalid');
    expect(ledger.get(proposal.requestId)).toEqual(result);
    expect(await service.consume(proposal)).toEqual(result);
    expect(search).not.toHaveBeenCalled();
    expect(final).not.toHaveBeenCalled();
  });

  it.each([
    { kind: 'text', content: '', model: 'test' },
    { kind: 'text', content: 'answer', model: null },
    { kind: 'tool_calls', content: 42 },
    { kind: 'tool_calls', model: '' },
  ])(
    'rejects malformed completion metadata before effects: %j',
    async (metadata) => {
      const { service, sessions, store } = open();
      await sessions.createSession('s1');
      const proposal = input();
      proposal.proposal = { ...proposal.proposal, ...metadata } as LlmResult;
      if (proposal.proposal.kind === 'text') {
        proposal.proposal = {
          kind: 'text',
          content: proposal.proposal.content,
          model: proposal.proposal.model,
        };
      }
      const search = jest.spyOn(store, 'searchMessages');
      const result = await service.consume(proposal);
      expect(result).toMatchObject({
        state: 'invalid',
        validation: { ok: false, failure: { code: 'invalid_proposal' } },
      });
      expect(await service.consume(proposal)).toEqual(result);
      expect(search).not.toHaveBeenCalled();
      expect(final).not.toHaveBeenCalled();
    },
  );

  it('persists invalid context without effects', async () => {
    const { service, sessions, store } = open();
    await sessions.createSession('s1');
    const proposal = input();
    proposal.context = [{ role: 'tool', callId: 'unpaired', content: '{}' }];
    const search = jest.spyOn(store, 'searchMessages');
    const result = await service.consume(proposal);
    expect(result).toMatchObject({
      state: 'invalid',
      validation: { ok: false, failure: { code: 'invalid_context' } },
    });
    expect(await service.consume(proposal)).toEqual(result);
    expect(search).not.toHaveBeenCalled();
    expect(final).not.toHaveBeenCalled();
  });

  it.each(['requestId', 'sessionId'] as const)(
    'requires trusted nonblank %s',
    async (field) => {
      const { service, database, store } = open();
      const search = jest.spyOn(store, 'searchMessages');
      await expect(
        service.consume({ ...input(), [field]: ' ' }),
      ).rejects.toThrow('invalid_request');
      expect(
        database.connection.prepare('SELECT * FROM tool_requests').all(),
      ).toEqual([]);
      expect(search).not.toHaveBeenCalled();
      expect(final).not.toHaveBeenCalled();
    },
  );

  it('closes text-only requests without another model call', async () => {
    const { service, sessions } = open();
    await sessions.createSession('s1');
    const proposal = input();
    proposal.proposal = { kind: 'text', content: 'answer', model: 'test' };
    const result = await service.consume(proposal);
    expect(result).toMatchObject({
      state: 'closed',
      invocationId: null,
      final: { state: 'not_required', result: proposal.proposal },
    });
    expect(await service.consume(proposal)).toEqual(result);
    expect(final).not.toHaveBeenCalled();
  });

  function renameInput(): ToolExecutionInput {
    const proposal = input();
    if (proposal.proposal.kind !== 'tool_calls') throw new Error('fixture');
    Object.assign(proposal.proposal.toolCalls[0], {
      name: 'session.rename',
      args: { title: 'new title' },
      rawArguments: '{"title":"new title"}',
    });
    return proposal;
  }

  /**
   * Pre-flip parked rename row: what register() used to mint for every
   * rename. Seeds the ledger + approval tables directly so the resume
   * path (kept for these legacy rows) stays covered after the
   * approval-free flip. Validation JSON is computed from the live
   * registry so resume-time revalidation agrees by construction.
   */
  async function seedParkedRename(
    opened: ReturnType<typeof open>,
    requestId = 'request-1',
    approvalId = 'appr-legacy',
  ): Promise<{ requestId: string; approvalId: string }> {
    const { database, sessions, registry } = opened;
    await sessions.createSession('s1');
    const proposal = renameInput();
    proposal.requestId = requestId;
    const validation = registry.validate(
      { name: 'session.rename', version: 1, args: { title: 'new title' } },
      { sessionId: 's1', allowedTools: proposal.allowedTools },
    );
    if (!validation.ok || !('request' in validation))
      throw new Error('fixture');
    const now = new Date().toISOString();
    database.connection
      .prepare(
        `INSERT INTO approvals
         (id, session_id, action, description, status, created_at, updated_at, expires_at)
       VALUES (?, 's1', 'session.rename', ?, 'pending', ?, ?, NULL)`,
      )
      .run(approvalId, 'Rename session to "new title"', now, now);
    database.connection
      .prepare(
        `INSERT INTO approval_events (approval_id, session_id, event, created_at)
       VALUES (?, 's1', 'created', ?)`,
      )
      .run(approvalId, now);
    database.connection
      .prepare(
        `INSERT INTO tool_requests
         (request_id, session_id, input_json, invocation_id, approval_id,
          state, validation_json, execution_token, ownership,
          final_state, final_json)
       VALUES (?, 's1', ?, 'inv-legacy-1', ?, 'awaiting_approval', ?, NULL,
               'unconfirmed', 'not_required', ?)`,
      )
      .run(
        requestId,
        JSON.stringify(proposal),
        approvalId,
        JSON.stringify(validation),
        JSON.stringify({ state: 'not_required' }),
      );
    return { requestId, approvalId };
  }

  it('executes rename inline without approval and exactly once', async () => {
    const { service, sessions, database } = open();
    await sessions.createSession('s1');
    const done = await service.consume(renameInput());
    expect(done).toMatchObject({
      state: 'succeeded',
      approvalId: null,
      execution: {
        ok: true,
        renamed: { sessionId: 's1', title: 'new title' },
      },
    });
    expect((await sessions.getSession('s1'))?.title).toBe('new title');
    expect(final).toHaveBeenCalledTimes(1);
    // No approval row minted for the approval-free path.
    expect(
      database.connection.prepare('SELECT COUNT(*) AS n FROM approvals').get(),
    ).toMatchObject({ n: 0 });
    // Second consume answers from the durable record, no re-execution.
    expect(await service.consume(renameInput())).toEqual(done);
    expect((await sessions.getSession('s1'))?.title).toBe('new title');
    expect(final).toHaveBeenCalledTimes(1);
  });

  it('still resumes pre-flip parked renames after approval, exactly once', async () => {
    const opened = open();
    const { service, sessions, ledger, approvalService } = opened;
    const parked = await seedParkedRename(opened);
    await approvalService.approve(parked.approvalId, 's1');
    const done = await service.resume(parked.requestId, 's1');
    expect(done).toMatchObject({
      state: 'succeeded',
      execution: {
        ok: true,
        renamed: { sessionId: 's1', title: 'new title' },
      },
      final: {
        state: 'succeeded',
        result: { kind: 'text', content: 'Found teal', model: 'test' },
      },
    });
    expect((await sessions.getSession('s1'))?.title).toBe('new title');
    expect(await service.resume(parked.requestId, 's1')).toEqual(done);
    expect(await service.consume(renameInput())).toEqual(done);
    const request = final.mock.calls[0][0];
    expect(request).toMatchObject({
      sessionId: 's1',
      tools: [],
      toolChoice: 'none',
    });
    expect(request.messages.at(-2)).toMatchObject({
      role: 'assistant',
      toolCalls: [{ id: done.invocationId }],
    });
    expect(request.messages.at(-1)).toEqual({
      role: 'tool',
      callId: done.invocationId,
      content: JSON.stringify(ledger.get('request-1')?.execution),
    });
    expect(final).toHaveBeenCalledTimes(1);
  });

  it('resumes a legacy parked rename from consume after approval', async () => {
    const opened = open();
    const { service, sessions } = opened;
    const parked = await seedParkedRename(opened);
    await opened.approvalService.approve(parked.approvalId, 's1');
    const done = await service.consume(renameInput());
    expect(done.state).toBe('succeeded');
    expect((await sessions.getSession('s1'))?.title).toBe('new title');
    expect(final).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['rejected', 'reject'],
    ['cancelled', 'cancel'],
  ] as const)('mirrors %s without executing', async (state, method) => {
    const opened = open();
    const { service, sessions, ledger } = opened;
    const parked = await seedParkedRename(opened);
    await opened.approvalService[method](parked.approvalId, 's1');
    const mirrored = await service.resume(parked.requestId, 's1');
    expect(mirrored).toMatchObject({
      state,
      execution: null,
      final: { state: 'not_required' },
    });
    expect(ledger.get('request-1')).toEqual(mirrored);
    expect(await service.resume(parked.requestId, 's1')).toEqual(mirrored);
    expect((await sessions.getSession('s1'))?.title).toBeUndefined();
    expect(final).not.toHaveBeenCalled();
  });

  it('mirrors expiry without executing', async () => {
    const opened = open();
    const { service, sessions, database } = opened;
    const parked = await seedParkedRename(opened);
    database.connection
      .prepare('UPDATE approvals SET expires_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00.000Z', parked.approvalId);
    expect((await opened.approvalService.get(parked.approvalId)).status).toBe(
      'expired',
    );
    const mirrored = await service.resume(parked.requestId, 's1');
    expect(mirrored).toMatchObject({
      state: 'expired',
      execution: null,
      final: { state: 'not_required' },
    });
    expect((await sessions.getSession('s1'))?.title).toBeUndefined();
    expect(final).not.toHaveBeenCalled();
  });

  it('denies resume from a forked session without touching the original', async () => {
    const opened = open();
    const { service, sessions } = opened;
    const parked = await seedParkedRename(opened);
    const forkId = 'fork-1';
    await sessions.forkSession('s1', forkId);
    await expect(service.resume(parked.requestId, forkId)).rejects.toThrow(
      'invalid_session',
    );
    await opened.approvalService.approve(parked.approvalId, 's1');
    await expect(service.resume(parked.requestId, forkId)).rejects.toThrow(
      'invalid_session',
    );
    expect((await sessions.getSession('s1'))?.title).toBeUndefined();
    const done = await service.resume(parked.requestId, 's1');
    expect(done.state).toBe('succeeded');
    expect((await sessions.getSession('s1'))?.title).toBe('new title');
  });

  it('keeps a legacy approved rename executable across restart, exactly once', async () => {
    const first = open();
    const parked = await seedParkedRename(first);
    await first.approvalService.approve(parked.approvalId, 's1');
    first.database.onModuleDestroy();
    const second = open();
    const done = await second.service.resume(parked.requestId, 's1');
    expect(done).toMatchObject({
      state: 'succeeded',
      execution: { ok: true, renamed: { title: 'new title' } },
    });
    expect((await second.sessions.getSession('s1'))?.title).toBe('new title');
    expect(await second.service.resume(parked.requestId, 's1')).toEqual(done);
    expect(final).toHaveBeenCalledTimes(1);
  });

  it('lets concurrent resumes converge on one rename', async () => {
    const first = open();
    const second = open();
    const parked = await seedParkedRename(first);
    await first.approvalService.approve(parked.approvalId, 's1');
    const [one, two] = await Promise.all([
      first.service.resume(parked.requestId, 's1'),
      second.service.resume(parked.requestId, 's1'),
    ]);
    expect(one.state).toBe('succeeded');
    expect(two.state).toBe('succeeded');
    expect(one.invocationId).toBe(two.invocationId);
    expect((await first.sessions.getSession('s1'))?.title).toBe('new title');
    expect(final).toHaveBeenCalledTimes(1);
  });

  it('invalidates an approved rename when revalidation no longer agrees', async () => {
    const opened = open();
    const { service, sessions, registry } = opened;
    const parked = await seedParkedRename(opened);
    await opened.approvalService.approve(parked.approvalId, 's1');
    jest.spyOn(registry, 'validate').mockReturnValue({
      ok: false,
      failure: { code: 'unpermitted_tool', message: 'secret' },
    });
    const result = await service.resume(parked.requestId, 's1');
    expect(result).toMatchObject({
      state: 'invalid',
      validation: { ok: false, failure: { code: 'unpermitted_tool' } },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect((await sessions.getSession('s1'))?.title).toBeUndefined();
    expect(final).not.toHaveBeenCalled();
  });

  it('keeps a rename result across failed final with no re-execution', async () => {
    const opened = open();
    const { service, sessions } = opened;
    const parked = await seedParkedRename(opened);
    await opened.approvalService.approve(parked.approvalId, 's1');
    final.mockRejectedValue(new Error('secret credential'));
    const result = await service.resume(parked.requestId, 's1');
    expect(result).toMatchObject({
      state: 'succeeded',
      execution: { ok: true, renamed: { title: 'new title' } },
      final: { state: 'failed', failure: { code: 'llm_failed' } },
    });
    expect(JSON.stringify(result)).not.toContain('secret credential');
    expect(await service.resume(parked.requestId, 's1')).toEqual(result);
    expect((await sessions.getSession('s1'))?.title).toBe('new title');
    expect(final).toHaveBeenCalledTimes(1);
  });

  it('resolves an orphaned rename claim to unknown truthfully, then completes', async () => {
    const opened = open();
    const { service, ledger } = opened;
    const parked = await seedParkedRename(opened);
    await opened.approvalService.approve(parked.approvalId, 's1');
    const validation = {
      ok: true as const,
      request: {
        name: 'session.rename' as const,
        version: 1 as const,
        sessionId: 's1',
        args: { title: 'new title' },
      },
    };
    const token = ledger.claimRename(parked.requestId, () => validation)!;
    expect(ledger.get('request-1')).toMatchObject({ state: 'executing' });
    expect(ledger.releaseOwner(token)).toBe(true);
    expect(ledger.resolveReleasedToUnknown('request-1')).toMatchObject({
      ok: false,
      failure: { code: 'unknown' },
    });
    const resumed = await service.resume(parked.requestId, 's1');
    expect(resumed).toMatchObject({
      state: 'failed',
      execution: { ok: false, failure: { code: 'unknown' } },
      final: {
        state: 'succeeded',
        result: { kind: 'text', content: 'Found teal', model: 'test' },
      },
    });
    expect(await service.resume(parked.requestId, 's1')).toEqual(resumed);
    expect(final).toHaveBeenCalledTimes(1);
  });

  it('rejects rebinding approval identity at the SQLite boundary', async () => {
    const opened = open();
    const { database } = opened;
    const parked = await seedParkedRename(opened);
    expect(() =>
      database.connection
        .prepare(
          'UPDATE tool_requests SET approval_id = ? WHERE request_id = ?',
        )
        .run('other-approval', parked.requestId),
    ).toThrow('immutable tool request');
    expect(() =>
      database.connection
        .prepare(
          'UPDATE tool_requests SET invocation_id = ? WHERE request_id = ?',
        )
        .run('other-invocation', parked.requestId),
    ).toThrow('immutable tool request');
  });

  it('keeps the execution result across reopen and failed final with no retries', async () => {
    const first = open();
    await first.sessions.createSession('s1');
    await first.sessions.appendMessage('s1', {
      role: 'user',
      content: 'teal evidence',
    });
    final.mockRejectedValue(new Error('secret credential'));
    const result = await first.service.consume(input());
    expect(result).toMatchObject({
      state: 'succeeded',
      execution: { ok: true },
      final: { state: 'failed', failure: { code: 'llm_failed' } },
    });
    expect(JSON.stringify(result)).not.toContain('secret credential');
    first.database.onModuleDestroy();
    const second = open();
    const search = jest.spyOn(second.store, 'searchMessages');
    expect(await second.service.consume(input())).toEqual(result);
    expect(search).not.toHaveBeenCalled();
    expect(final).toHaveBeenCalledTimes(1);
  });

  it('captures caller snapshots and pairs the durable invocation ID with tools disabled', async () => {
    const { service, sessions, ledger } = open();
    await sessions.createSession('s1');
    const proposal = input();
    const running = service.consume(proposal);
    proposal.context[0].content = 'mutated';
    if (proposal.proposal.kind === 'tool_calls')
      proposal.proposal.toolCalls[0].args.query = 'mutated';
    proposal.allowedTools = [];
    const result = await running;
    const request = final.mock.calls[0][0];
    expect(() => new ToolOffer(request)).not.toThrow();
    expect(request).toMatchObject({
      sessionId: 's1',
      tools: [],
      toolChoice: 'none',
    });
    expect(request.messages[0]).toEqual({ role: 'user', content: 'Find teal' });
    expect(request.messages[1]).toMatchObject({
      role: 'assistant',
      toolCalls: [
        { id: result.invocationId, args: { query: 'teal', limit: 1 } },
      ],
    });
    expect(request.messages[2]).toEqual({
      role: 'tool',
      callId: result.invocationId,
      content: JSON.stringify(ledger.get('request-1')?.execution),
    });
    expect(result.invocationId).not.toBe('model-id');
  });

  it('rejects tool calls returned by a final mock without executing them', async () => {
    const { service, sessions, store } = open();
    await sessions.createSession('s1');
    const search = jest.spyOn(store, 'searchMessages');
    final.mockResolvedValue(input().proposal);
    const result = await service.consume(input());
    expect(result.final).toMatchObject({
      state: 'failed',
      failure: { code: 'invalid_final' },
    });
    await service.consume(input());
    expect(search).toHaveBeenCalledTimes(1);
    expect(final).toHaveBeenCalledTimes(1);
  });

  it.each([
    { kind: 'text', content: ' ', model: 'test' },
    { kind: 'text', content: 'answer' },
    { kind: 'text', content: 'answer', model: 'test', tool_calls: [] },
  ])('persists invalid final output without retries: %j', async (output) => {
    const { service, sessions } = open();
    await sessions.createSession('s1');
    final.mockResolvedValue(output as LlmResult);
    const result = await service.consume(input());
    expect(result.final).toEqual({
      state: 'failed',
      failure: { code: 'invalid_final' },
    });
    expect(await service.consume(input())).toEqual(result);
    expect(final).toHaveBeenCalledTimes(1);
  });

  it('bounds final text independently of durable search results', async () => {
    const { service, sessions } = open();
    await sessions.createSession('s1');
    final.mockResolvedValue({
      kind: 'text',
      content: 'x'.repeat(65536),
      model: 'test',
    });
    const result = await service.consume(input());
    expect(result).toMatchObject({
      state: 'succeeded',
      execution: { ok: true },
      final: { state: 'failed', failure: { code: 'final_too_large' } },
    });
    expect(await service.consume(input())).toEqual(result);
    expect(final).toHaveBeenCalledTimes(1);
  });

  it('does not auto-create missing sessions', async () => {
    const { service, database } = open();
    await expect(service.consume(input())).rejects.toThrow('session_not_found');
    expect(database.connection.prepare('SELECT * FROM sessions').all()).toEqual(
      [],
    );
    expect(final).not.toHaveBeenCalled();
  });

  it('leaves execution claim ambiguous when durable result writing fails', async () => {
    const { service, sessions, database, ledger, store } = open();
    await sessions.createSession('s1');
    const search = jest.spyOn(store, 'searchMessages');
    database.connection.exec(
      "CREATE TRIGGER fail_result BEFORE UPDATE OF execution_json ON tool_requests WHEN NEW.execution_json IS NOT NULL BEGIN SELECT RAISE(ABORT, 'secret database error'); END",
    );
    await expect(service.consume(input())).rejects.toThrow(
      'ledger_unavailable',
    );
    expect(ledger.get('request-1')).toMatchObject({
      state: 'executing',
      execution: null,
    });
    database.connection.exec('DROP TRIGGER fail_result');
    database.onModuleDestroy();
    const reopened = open();
    expect(await reopened.service.consume(input())).toMatchObject({
      state: 'executing',
      execution: null,
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(final).not.toHaveBeenCalled();
  });

  it('leaves final claim pending on final result-write failure, never retries', async () => {
    const { service, sessions, database } = open();
    await sessions.createSession('s1');
    database.connection.exec(
      "CREATE TRIGGER fail_final BEFORE UPDATE OF final_json ON tool_requests WHEN NEW.final_state = 'succeeded' BEGIN SELECT RAISE(ABORT, 'secret'); END",
    );
    await expect(service.consume(input())).rejects.toThrow(
      'ledger_unavailable',
    );
    database.onModuleDestroy();
    expect(await open().service.consume(input())).toMatchObject({
      state: 'succeeded',
      execution: { ok: true },
      final: { state: 'claimed' },
    });
    expect(final).toHaveBeenCalledTimes(1);
  });

  it('bounds durable results with explicit failure, never false success', async () => {
    const { service, sessions } = open();
    await sessions.createSession('s1');
    await sessions.appendMessage('s1', {
      role: 'user',
      content: `teal ${'x'.repeat(65536)}`,
    });
    const result = await service.consume(input());
    expect(result).toMatchObject({
      state: 'failed',
      execution: { ok: false, failure: { code: 'result_too_large' } },
    });
    expect(Buffer.byteLength(JSON.stringify(result.execution))).toBeLessThan(
      65536,
    );
  });

  it('revalidates registry policy in the atomic execution claim', async () => {
    const { service, sessions, registry, store } = open();
    await sessions.createSession('s1');
    const original = new ToolRegistry();
    jest
      .spyOn(registry, 'validate')
      .mockImplementationOnce((proposal, context) =>
        original.validate(proposal, context),
      )
      .mockReturnValue({
        ok: false,
        failure: { code: 'unpermitted_tool', message: 'secret' },
      });
    const search = jest.spyOn(store, 'searchMessages');
    expect(await service.consume(input())).toMatchObject({
      state: 'invalid',
      validation: { ok: false, failure: { code: 'unpermitted_tool' } },
    });
    expect(search).not.toHaveBeenCalled();
    expect(final).not.toHaveBeenCalled();
  });

  it('resumes only unclaimed final work from durable execution after restart', async () => {
    const first = open();
    await first.sessions.createSession('s1');
    const claim = jest.spyOn(first.ledger, 'claimFinal').mockReturnValue(null);
    const saved = await first.service.consume(input());
    expect(saved.final.state).toBe('pending');
    expect(final).not.toHaveBeenCalled();
    claim.mockRestore();
    first.database.onModuleDestroy();
    const second = open();
    const search = jest.spyOn(second.store, 'searchMessages');
    final.mockRejectedValue(new Error('secret'));
    const resumed = await second.service.consume(input());
    expect(resumed.execution).toEqual(saved.execution);
    expect(resumed.invocationId).toBe(saved.invocationId);
    expect(resumed.final).toEqual({
      state: 'failed',
      failure: { code: 'llm_failed' },
    });
    expect(search).not.toHaveBeenCalled();
    expect(await second.service.consume(input())).toEqual(resumed);
    expect(final).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'failure'] as const)(
    'wait timeout leaves sole owner to persist eventual %s',
    async (outcome) => {
      const { ledger, store, registry, sessions, approvals, approvalService } =
        open();
      await sessions.createSession('s1');
      let release!: (value: []) => void;
      let reject!: (error: Error) => void;
      const finish = jest.spyOn(ledger, 'finishSearch');
      const search = jest.spyOn(store, 'searchMessages').mockImplementation(
        () =>
          new Promise((resolve, fail) => {
            release = resolve;
            reject = fail;
          }),
      );
      const service = new ToolExecutionService(
        ledger,
        store,
        registry,
        { chatWithTools: final },
        approvals,
        { searchTimeoutMs: 5 },
        undefined,
        approvalService,
        {
          callTool: () => Promise.reject(new Error('mcp unwired')),
        } as unknown as McpConnectionService,
        noopClarifications,
      );
      const result = await service.consume(input());
      expect(result).toMatchObject({
        state: 'executing',
        execution: null,
        ownership: 'unconfirmed',
      });
      expect(await service.consume(input())).toEqual(result);
      expect(finish).not.toHaveBeenCalled();
      expect(final).not.toHaveBeenCalled();
      if (outcome === 'success') release([]);
      else reject(new Error('secret'));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(ledger.get('request-1')).toMatchObject({
        state: outcome === 'success' ? 'succeeded' : 'failed',
        execution:
          outcome === 'success'
            ? { ok: true, matches: [] }
            : { ok: false, failure: { code: 'search_failed' } },
        final: { state: 'pending' },
      });
      expect(final).not.toHaveBeenCalled();
      await service.consume(input());
      await service.consume(input());
      expect(finish).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledTimes(1);
      expect(final).toHaveBeenCalledTimes(1);
    },
  );

  it('orphaned claim stays blocked; explicit release resolves unknown truthfully then completes', async () => {
    const first = open();
    const second = open();
    await first.sessions.createSession('s1');
    let release!: (value: []) => void;
    jest.spyOn(first.store, 'searchMessages').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let releaseFinal!: (value: LlmResult) => void;
    final.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseFinal = resolve;
        }),
    );
    const running = first.service
      .consume(input())
      .catch(() => 'ledger_unavailable');
    expect((await second.service.consume(input())).ownership).toBe(
      'unconfirmed',
    );
    expect(final).not.toHaveBeenCalled();
    first.database.onModuleDestroy();
    release([]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(await second.service.consume(input())).toMatchObject({
      state: 'executing',
      execution: null,
      ownership: 'unconfirmed',
    });
    expect(final).not.toHaveBeenCalled();
    const released = second.ledger.releaseOwner(
      second.ledger.get('request-1')!.executionToken!,
    );
    expect(released).toBe(true);
    expect(second.ledger.releaseOwner('missing-token')).toBe(false);
    expect(second.ledger.resolveReleasedToUnknown('request-1')).toMatchObject({
      ok: false,
      failure: { code: 'unknown' },
    });
    expect(second.ledger.get('request-1')).toMatchObject({
      state: 'failed',
      execution: { ok: false, failure: { code: 'unknown' } },
      final: { state: 'pending' },
    });
    const finalRunning = second.service.consume(input());
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(second.ledger.get('request-1')).toMatchObject({
      final: { state: 'claimed' },
    });
    expect(await second.service.consume(input())).toMatchObject({
      final: { state: 'claimed' },
    });
    releaseFinal({ kind: 'text', content: 'done', model: 'test' });
    const terminal = await finalRunning;
    expect(terminal.final).toEqual({
      state: 'succeeded',
      result: { kind: 'text', content: 'done', model: 'test' },
    });
    expect(await second.service.consume(input())).toEqual(terminal);
    await expect(running).resolves.toBe('ledger_unavailable');
  });

  it('keeps model call IDs independent of caller request identity', async () => {
    const { service, sessions } = open();
    await sessions.createSession('s1');
    const first = await service.consume(input());
    const second = await service.consume({
      ...input(),
      requestId: 'request-2',
    });
    expect(second.invocationId).not.toBe(first.invocationId);
    expect(final).toHaveBeenCalledTimes(2);
  });

  it('conflicts when revalidation no longer equals the durable validation', async () => {
    const { ledger, sessions, database, registry, service } = open();
    await sessions.createSession('s1');
    const validation = {
      ok: true as const,
      request: {
        name: 'session.search' as const,
        version: 1 as const,
        sessionId: 's1',
        args: { query: 'teal', limit: 1 },
      },
    };
    ledger.register(JSON.stringify(input()), () => validation);
    jest.spyOn(registry, 'validate').mockReturnValue({
      ok: true,
      request: { ...validation.request, args: { query: 'teal', limit: 2 } },
    });
    expect(await service.consume(input())).toMatchObject({
      state: 'invalid',
      validation: { ok: false, failure: { code: 'unpermitted_tool' } },
    });
    expect(
      await database.connection
        .prepare('SELECT execution_json FROM tool_requests')
        .get(),
    ).toEqual({ execution_json: null });
    expect(final).not.toHaveBeenCalled();
  });

  it('contending registrars converge on one durable row without replacement', async () => {
    const first = open();
    const second = open();
    await first.sessions.createSession('s1');
    const results = await Promise.all([
      first.service.consume(input()).then((record) => record.requestId),
      second.service.consume(input()).then((record) => record.requestId),
    ]);
    expect(new Set(results).size).toBe(1);
    expect(
      first.database.connection
        .prepare('SELECT COUNT(*) AS count FROM tool_requests')
        .get(),
    ).toEqual({ count: 1 });
    expect(second.ledger.get('request-1')).not.toBeNull();
  });

  it('creates tool_requests and its immutability trigger on upgraded existing databases', async () => {
    const first = open();
    await first.sessions.createSession('s1');
    first.database.onModuleDestroy();
    const path = join(dir, 'sessions.sqlite');
    const raw = new Database(path);
    raw.exec('DROP TABLE tool_requests');
    raw.exec('DROP TRIGGER IF EXISTS tool_requests_identity_immutable');
    raw.close();
    const second = open();
    const record = second.ledger.register(
      JSON.stringify(input()),
      () =>
        ({
          ok: true,
          request: {
            name: 'session.search',
            version: 1,
            sessionId: 's1',
            args: { query: 'teal', limit: 1 },
          },
        }) as never,
    );
    expect(record.state).toBe('validated');
    expect(() =>
      second.database.connection
        .prepare(
          "UPDATE tool_requests SET input_json = '{}' WHERE request_id = ?",
        )
        .run(record.requestId),
    ).toThrow('immutable tool request');
  });

  it('checks owner tokens and immutable identity at the SQLite boundary', async () => {
    const { ledger, sessions, database } = open();
    await sessions.createSession('s1');
    const validation = {
      ok: true as const,
      request: {
        name: 'session.search' as const,
        version: 1 as const,
        sessionId: 's1',
        args: { query: 'teal', limit: 1 },
      },
    };
    const record = ledger.register(JSON.stringify(input()), () => validation);
    expect(() =>
      database.connection
        .prepare(
          "UPDATE tool_requests SET input_json = '{}' WHERE request_id = ?",
        )
        .run(record.requestId),
    ).toThrow('immutable tool request');
    const token = ledger.claimSearch(record.requestId, () => validation)!;
    expect(ledger.claimSearch(record.requestId, () => validation)).toBeNull();
    expect(() =>
      ledger.finishSearch(record.requestId, 'wrong', { ok: true, matches: [] }),
    ).toThrow('claim_lost');
    ledger.finishSearch(record.requestId, token, { ok: true, matches: [] });
    expect(() =>
      ledger.finishSearch(record.requestId, token, { ok: true, matches: [] }),
    ).toThrow('claim_lost');
    const finalToken = ledger.claimFinal(record.requestId)!;
    expect(ledger.claimFinal(record.requestId)).toBeNull();
    const outcome = {
      state: 'failed' as const,
      failure: { code: 'llm_failed' as const },
    };
    expect(() =>
      ledger.finishFinal(record.requestId, 'wrong', outcome),
    ).toThrow('claim_lost');
    ledger.finishFinal(record.requestId, finalToken, outcome);
    expect(() =>
      ledger.finishFinal(record.requestId, finalToken, outcome),
    ).toThrow('claim_lost');
  });

  it('persists sanitized handler failures before final response', async () => {
    const { service, sessions, store } = open();
    await sessions.createSession('s1');
    jest.spyOn(store, 'searchMessages').mockRejectedValue(new Error('secret'));
    const result = await service.consume(input());
    expect(result).toMatchObject({
      state: 'failed',
      execution: { ok: false, failure: { code: 'search_failed' } },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(final).toHaveBeenCalledTimes(1);
  });

  it('parks a channel.send for approval, then sends on grant', async () => {
    const sent: unknown[] = [];
    const channels = {
      send: (request: unknown) => {
        sent.push(request);
        return Promise.resolve({ messageId: 'm1', deliveryId: 'd1' });
      },
    };
    const opened = open(channels);
    await opened.sessions.createSession('s1');
    const proposal: ToolExecutionInput = {
      requestId: 'request-send',
      sessionId: 's1',
      context: [{ role: 'user', content: 'ping me' }],
      allowedTools: ['channel.send'],
      proposal: {
        kind: 'tool_calls',
        model: 'test',
        content: null,
        toolCalls: [
          {
            id: 'model-id',
            name: 'channel.send',
            version: 1,
            rawArguments:
              '{"channel":"discord","target":"operator","body":"ping"}',
            args: { channel: 'discord', target: 'operator', body: 'ping' },
          },
        ],
      },
    };

    const parked = await opened.service.consume(proposal);
    expect(parked.state).toBe('awaiting_approval');
    const approval = await opened.approvalService.get(parked.approvalId ?? '');
    expect(approval?.action).toBe('channel.send');

    await opened.approvalService.approve(parked.approvalId ?? '', 's1');
    const done = await opened.service.resume(proposal.requestId, 's1');

    expect(done).toMatchObject({
      state: 'succeeded',
      execution: {
        ok: true,
        channelSend: { messageId: 'm1', deliveryId: 'd1' },
      },
    });
    expect(sent[0]).toMatchObject({ target: 'operator', body: 'ping' });
  });
});

describe('ToolExecutionService foreign tools (M13b)', () => {
  let dir = '';
  const databases: SessionDatabaseService[] = [];
  const final = jest.fn<Promise<LlmResult>, [LlmToolRequest]>();

  const argsSchema = {
    type: 'object' as const,
    additionalProperties: false as const,
    required: ['path'] as readonly string[],
    properties: {
      path: { type: 'string' },
    } as Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  };

  const source = {
    listForeign: () => [
      {
        name: 'mcp_files_read',
        server: 'files',
        tool: 'read',
        description: 'Read a file',
        approval: 'required' as const,
        argsSchema,
      },
      {
        name: 'mcp_open_go',
        server: 'open',
        tool: 'go',
        description: 'Go',
        approval: 'none' as const,
        argsSchema: {
          type: 'object' as const,
          additionalProperties: false as const,
          required: [] as readonly string[],
          properties: {} as Readonly<
            Record<string, Readonly<Record<string, unknown>>>
          >,
        },
      },
    ],
    lookupForeign: (name: string) =>
      name === 'mcp_files_read'
        ? {
            name: 'mcp_files_read',
            server: 'files',
            tool: 'read',
            description: 'Read a file',
            approval: 'required' as const,
            argsSchema,
          }
        : name === 'mcp_open_go'
          ? {
              name: 'mcp_open_go',
              server: 'open',
              tool: 'go',
              description: 'Go',
              approval: 'none' as const,
              argsSchema: {
                type: 'object' as const,
                additionalProperties: false as const,
                required: [] as readonly string[],
                properties: {} as Readonly<
                  Record<string, Readonly<Record<string, unknown>>>
                >,
              },
            }
          : undefined,
  };

  function openForeign(
    call?: (tool: string) => {
      text: string;
      isError: boolean;
    },
  ) {
    const config = {
      sessionDbPath: join(dir, 'sessions.sqlite'),
      memoryDbPath: join(dir, 'unused.sqlite'),
      maxHistory: 50,
    } as CoreConfig;
    const database = new SessionDatabaseService(config);
    database.onModuleInit();
    databases.push(database);
    const sessions = new SqliteSessionRepository(database);
    const store = new SessionStore(sessions, config);
    const ledger = new ToolExecutionRepository(database);
    const registry = new ToolRegistry(source);
    const approvals = new SqliteApprovalRepository(database);
    const approvalService = new ApprovalService(
      approvals,
      sessions,
      new NoopPublisher(),
    );
    const mcpCall = jest.fn<
      Promise<{ text: string; isError: boolean; attachments: [] }>,
      [string, Record<string, unknown>]
    >((tool) =>
      Promise.resolve(
        call
          ? { ...call(tool), attachments: [] }
          : { text: `content:${tool}`, isError: false, attachments: [] },
      ),
    );
    const service = new ToolExecutionService(
      ledger,
      store,
      registry,
      { chatWithTools: final },
      approvals,
      {},
      undefined,
      approvalService,
      {
        callTool: (
          _server: string,
          tool: string,
          _args: Record<string, unknown>,
        ) => mcpCall(tool, _args),
      } as unknown as McpConnectionService,
      noopClarifications,
    );
    return {
      database,
      sessions,
      store,
      ledger,
      registry,
      service,
      approvals,
      mcpCall,
    };
  }

  function foreignInput(
    name = 'mcp_files_read',
    args: Record<string, unknown> = { path: '/x' },
    requestId = 'request-9',
  ): ToolExecutionInput {
    return {
      requestId,
      sessionId: 's1',
      context: [{ role: 'user', content: 'Read it' }],
      allowedTools: [name],
      proposal: {
        kind: 'tool_calls',
        model: 'test',
        content: null,
        toolCalls: [
          {
            id: 'model-id',
            name,
            version: 1,
            rawArguments: JSON.stringify(args),
            args,
          },
        ],
      },
    };
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-tools-mcp-'));
    final.mockReset().mockResolvedValue({
      kind: 'text',
      content: 'File says hi',
      model: 'test',
    });
  });

  afterEach(() => {
    databases.splice(0).forEach((database) => database.onModuleDestroy());
    rmSync(dir, { recursive: true, force: true });
  });

  it('parks approval-required foreign calls with a minted approval', async () => {
    const h = openForeign();
    await h.sessions.createSession('s1');

    const parked = await h.service.consume(foreignInput());
    expect(parked.state).toBe('awaiting_approval');
    expect(parked.approvalId).toBeDefined();
    expect(parked.validation).toMatchObject({
      ok: true,
      request: { foreign: { server: 'files', tool: 'read' } },
    });
    // Stable across re-consumes: no duplicate approvals, no execution.
    const again = await h.service.consume(foreignInput());
    expect(again.approvalId).toBe(parked.approvalId);
    expect(h.mcpCall).not.toHaveBeenCalled();
    const approvals = await h.approvals.listApprovals();
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ action: 'mcp.execute' });
  });

  it('executes on grant through the generic claim/finish pair', async () => {
    const h = openForeign();
    await h.sessions.createSession('s1');

    const parked = await h.service.consume(foreignInput());
    await h.approvals.resolveApproval(parked.approvalId ?? '', 'approved');
    const done = await h.service.resume('request-9', 's1');
    expect(done.state).toBe('succeeded');
    expect(done.execution).toMatchObject({
      ok: true,
      mcp: { server: 'files', tool: 'read', text: 'content:read' },
    });
    expect(h.mcpCall).toHaveBeenCalledTimes(1);
    expect(h.mcpCall.mock.calls[0]).toEqual(['read', { path: '/x' }]);
    // Exactly-once: resume again changes nothing.
    expect((await h.service.resume('request-9', 's1')).state).toBe('succeeded');
    expect(h.mcpCall).toHaveBeenCalledTimes(1);
  });

  it('never executes on denial', async () => {
    const h = openForeign();
    await h.sessions.createSession('s1');

    const parked = await h.service.consume(foreignInput());
    await h.approvals.resolveApproval(parked.approvalId ?? '', 'rejected');
    const done = await h.service.resume('request-9', 's1');
    expect(done.state).toBe('rejected');
    expect(h.mcpCall).not.toHaveBeenCalled();
  });

  it('executes approval-free foreign tools inline', async () => {
    const h = openForeign();
    await h.sessions.createSession('s1');

    const done = await h.service.consume(foreignInput('mcp_open_go', {}));
    expect(done.state).toBe('succeeded');
    expect(done.approvalId).toBeNull();
    expect(done.execution).toMatchObject({
      ok: true,
      mcp: { server: 'open', tool: 'go' },
    });
  });

  it('maps remote failures honestly without leaking internals', async () => {
    const h = openForeign(() => {
      throw new Error('connection reset by peer');
    });
    await h.sessions.createSession('s1');

    const parked = await h.service.consume(foreignInput());
    await h.approvals.resolveApproval(parked.approvalId ?? '', 'approved');
    const done = await h.service.resume('request-9', 's1');
    expect(done).toMatchObject({
      state: 'failed',
      execution: { ok: false, failure: { code: 'mcp_failed' } },
    });
    expect(JSON.stringify(done)).not.toContain('reset by peer');
  });

  it('maps remote isError to failure, never success', async () => {
    const h = openForeign(() => ({ text: 'remote refused', isError: true }));
    await h.sessions.createSession('s1');

    const parked = await h.service.consume(foreignInput());
    await h.approvals.resolveApproval(parked.approvalId ?? '', 'approved');
    const done = await h.service.resume('request-9', 's1');
    expect(done).toMatchObject({
      state: 'failed',
      execution: { ok: false, failure: { code: 'mcp_failed' } },
    });
  });

  it('fails oversized results instead of storing them', async () => {
    const h = openForeign(() => ({
      text: 'x'.repeat(70 * 1024),
      isError: false,
    }));
    await h.sessions.createSession('s1');

    const done = await h.service.consume(foreignInput('mcp_open_go', {}));
    expect(done).toMatchObject({
      state: 'failed',
      execution: { ok: false, failure: { code: 'result_too_large' } },
    });
  });
});
