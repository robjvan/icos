import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { SessionDatabaseService } from '../session/session-database.service';
import { SqliteSessionRepository } from '../session/sqlite-session.repository';
import { SessionStore } from '../conversation/session.store';
import { AgentRunRepository } from '../agent/agent-run.repository';
import type { TurnOutcome } from '../conversation/conversation.service';
import { SqliteDelegationRepository } from './sqlite-delegation.repository';
import { ToolRegistry } from '../tools/tool-registry';
import { ToolPullStore } from '../tools/tool-pull.store';
import { ToolSurfaceService } from '../tools/tool-surface.service';
import { SubagentRunner } from './subagent-runner.service';
import { buildChildMessage, truncateSummary } from './subagent-runner.service';

function testConfig(overrides: Partial<CoreConfig> = {}): CoreConfig {
  return {
    maxHistory: 50,
    subagentsEnabled: true,
    subagentMaxConcurrent: 4,
    subagentMaxIterations: 5,
    subagentMaxToolSteps: 5,
    subagentMaxTurnDurationMs: 300000,
    subagentResultMaxChars: 50,
    ...overrides,
  } as CoreConfig;
}

function okOutcome(reply: string): TurnOutcome {
  return {
    status: 'ok',
    sessionId: 'child',
    requestId: 'req-1',
    reply,
    model: 'test-model',
  };
}

/** Let detached background promises settle. */
async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('SubagentRunner', () => {
  let dir = '';
  let database: SessionDatabaseService;
  let delegations: SqliteDelegationRepository;
  let sessions: SessionStore;
  let runs: AgentRunRepository;
  let converse: jest.Mock;
  let surface: ToolSurfaceService;
  let turns: { converse: jest.Mock };
  let runner: SubagentRunner;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'icos-subagents-'));
    database = new SessionDatabaseService({
      sessionDbPath: join(dir, 'sessions.sqlite'),
    } as CoreConfig);
    database.onModuleInit();
    const sessionRepo = new SqliteSessionRepository(database);
    await sessionRepo.createSession('parent-1');
    sessions = new SessionStore(sessionRepo, testConfig());
    runs = new AgentRunRepository(database);
    delegations = new SqliteDelegationRepository(database);
    converse = jest.fn(() => Promise.resolve(okOutcome('child did the thing')));
    surface = new ToolSurfaceService(
      testConfig(),
      new ToolRegistry(),
      new ToolPullStore(),
    );
    turns = { converse };
    runner = new SubagentRunner(
      testConfig(),
      delegations,
      sessions,
      runs,
      surface,
      turns,
    );
  });

  afterEach(() => {
    database.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  });

  it('spawns a child and completes it with a truncated summary', async () => {
    converse.mockResolvedValueOnce(
      okOutcome(
        'the child researched widgets thoroughly and found three relevant suppliers with pricing',
      ),
    );
    const spawned = await runner.spawn({
      parentSessionId: 'parent-1',
      goal: 'do the thing',
      context: 'be quick',
    });
    expect(spawned.spawned).toBe(true);
    if (!spawned.spawned) return;
    expect(converse).toHaveBeenCalledWith(
      expect.stringContaining('Goal: do the thing'),
      expect.any(String),
      {
        limits: {
          maxIterations: 5,
          maxToolSteps: 5,
          maxTurnDurationMs: 300000,
        },
      },
    );
    const childSessionId = (await delegations.get(spawned.taskId))
      ?.childSessionId;
    expect(childSessionId).toBeDefined();
    expect(childSessionId).not.toBe('parent-1');

    await flush();
    const done = await runner.status(spawned.taskId);
    expect(done?.state).toBe('completed');
    // Result cap is 50 chars: the summary truncates with a marker.
    expect(done?.resultSummary).toContain('…[truncated');
  });

  it('narrows the child universe from delegate args', async () => {
    const spawned = await runner.spawn({
      parentSessionId: 'parent-1',
      goal: 'g',
      toolsets: ['memory'],
      tools: ['todo'],
    });
    expect(spawned.spawned).toBe(true);
    if (!spawned.spawned) return;
    const child = (await delegations.get(spawned.taskId))?.childSessionId;
    expect(child).toBeDefined();
    const names = surface.universe(child as string).map((d) => d.name);
    expect(names).toContain('memory');
    expect(names).toContain('todo');
    expect(names).not.toContain('terminal');
    // Unrestricted spawns leave no overlay behind.
    const open = await runner.spawn({ parentSessionId: 'parent-1', goal: 'h' });
    expect(open.spawned).toBe(true);
    if (!open.spawned) return;
    const openChild = (await delegations.get(open.taskId))?.childSessionId;
    expect(surface.universe(openChild as string).map((d) => d.name)).toContain(
      'terminal',
    );
  });

  it('refuses when disabled, when capped, and for child callers', async () => {
    const disabled = new SubagentRunner(
      testConfig({ subagentsEnabled: false }),
      delegations,
      sessions,
      runs,
      surface,
      turns,
    );
    const disabledRes = await disabled.spawn({
      parentSessionId: 'parent-1',
      goal: 'g',
    });
    expect(disabledRes.spawned).toBe(false);
    if (!disabledRes.spawned) {
      expect(disabledRes.reason).toContain('disabled');
    }

    const capped = new SubagentRunner(
      testConfig({ subagentMaxConcurrent: 0 }),
      delegations,
      sessions,
      runs,
      surface,
      turns,
    );
    const cappedRes = await capped.spawn({
      parentSessionId: 'parent-1',
      goal: 'g',
    });
    expect(cappedRes.spawned).toBe(false);
    if (!cappedRes.spawned) {
      expect(cappedRes.reason).toContain('cap');
    }

    const first = await runner.spawn({
      parentSessionId: 'parent-1',
      goal: 'g',
    });
    expect(first.spawned).toBe(true);
    if (!first.spawned) return;
    const child = (await delegations.get(first.taskId))?.childSessionId;
    expect(child).toBeDefined();
    // A child session cannot delegate further (flat hierarchy).
    const nestedRes = await runner.spawn({
      parentSessionId: child as string,
      goal: 'nested',
    });
    expect(nestedRes.spawned).toBe(false);
    if (!nestedRes.spawned) {
      expect(nestedRes.reason).toContain('further');
    }
  });

  it('maps a cancelled outcome onto the delegation', async () => {
    converse.mockResolvedValueOnce({
      ...okOutcome('partial work'),
      outcome: 'cancelled',
    });
    const spawned = await runner.spawn({
      parentSessionId: 'parent-1',
      goal: 'g',
    });
    expect(spawned.spawned).toBe(true);
    if (!spawned.spawned) return;
    await flush();
    expect((await runner.status(spawned.taskId))?.state).toBe('cancelled');
  });

  it('parks on approval and reconciles on completion', async () => {
    converse.mockResolvedValueOnce({
      ...okOutcome(''),
      status: 'approval_required',
      approval: { approvalId: 'a1', invocationId: 'i1', tool: 'terminal' },
    });
    const spawned = await runner.spawn({
      parentSessionId: 'parent-1',
      goal: 'g',
    });
    expect(spawned.spawned).toBe(true);
    if (!spawned.spawned) return;
    await flush();
    expect((await runner.status(spawned.taskId))?.state).toBe(
      'awaiting_approval',
    );

    // The operator approves; the normal resume path finishes the child run.
    const child = (await delegations.get(spawned.taskId))?.childSessionId;
    expect(child).toBeDefined();
    const run = runs.createRun({
      sessionId: child as string,
      goal: 'g',
      limits: { maxIterations: 5, maxToolSteps: 5, maxTurnDurationMs: 300 },
    });
    runs.markTerminal(run.id, 'completed', {
      reason: 'final_answer',
      toolSteps: 1,
    });
    await sessions.append(child as string, {
      role: 'assistant',
      content: 'all done, here is the result',
    });
    const done = await runner.status(spawned.taskId);
    expect(done?.state).toBe('completed');
    expect(done?.resultSummary).toContain('all done');
  });

  it('records a child throw as failed, never escaping', async () => {
    converse.mockRejectedValueOnce(new Error('provider boom'));
    const spawned = await runner.spawn({
      parentSessionId: 'parent-1',
      goal: 'g',
    });
    expect(spawned.spawned).toBe(true);
    if (!spawned.spawned) return;
    await flush();
    const failed = await runner.status(spawned.taskId);
    expect(failed?.state).toBe('failed');
    expect(failed?.error).toContain('provider boom');
  });

  it('marks non-terminal delegations failed on init (restart)', async () => {
    // A blocked child is still running when the "restart" happens.
    let release!: (value: TurnOutcome) => void;
    converse.mockImplementationOnce(
      () =>
        new Promise<TurnOutcome>((resolve) => {
          release = resolve;
        }),
    );
    const spawned = await runner.spawn({
      parentSessionId: 'parent-1',
      goal: 'g',
    });
    expect(spawned.spawned).toBe(true);
    if (!spawned.spawned) return;
    // A fresh runner on the same store simulates a restart.
    const restarted = new SubagentRunner(
      testConfig(),
      delegations,
      sessions,
      runs,
      surface,
      turns,
    );
    restarted.onModuleInit();
    await flush();
    const failed = await restarted.status(spawned.taskId);
    expect(failed?.state).toBe('failed');
    expect(failed?.error).toBe('restart');
    // The orphaned background promise still settles harmlessly: the record
    // is terminal, so run() is a no-op and the slot frees.
    release(okOutcome('late'));
    await flush();
    expect((await restarted.status(spawned.taskId))?.state).toBe('failed');
  });

  it('cancels cooperatively and leaves terminal states alone', async () => {
    const spawned = await runner.spawn({
      parentSessionId: 'parent-1',
      goal: 'g',
    });
    expect(spawned.spawned).toBe(true);
    if (!spawned.spawned) return;
    await flush();
    expect((await runner.status(spawned.taskId))?.state).toBe('completed');
    // Cancelling a finished child is a no-op, never a regression.
    expect((await runner.cancel(spawned.taskId))?.state).toBe('completed');
    expect(await runner.cancel('nope')).toBeNull();
    expect(await runner.status('nope')).toBeNull();
  });

  it('builds an explicit, non-inheriting child message', () => {
    const message = buildChildMessage('research X', null);
    expect(message).toContain('Goal: research X');
    expect(message).toContain('(none provided)');
    expect(truncateSummary('short', 50)).toBe('short');
    expect(truncateSummary('x'.repeat(60), 50)).toContain('…[truncated 10');
  });

  it('lists newest-first with reconciliation', async () => {
    expect(await runner.list('parent-1')).toEqual([]);
    const first = await runner.spawn({
      parentSessionId: 'parent-1',
      goal: 'first',
    });
    expect(first.spawned).toBe(true);
    if (!first.spawned) return;
    await flush();
    // Completed directly: listed as-is.
    const listed = await runner.list('parent-1');
    expect(listed.map((d) => d.id)).toEqual([first.taskId]);
    expect(listed[0]?.state).toBe('completed');
    // Bounded.
    expect(await runner.list('parent-1', 0)).toEqual([]);
    expect(await runner.list('nobody')).toEqual([]);
  });
});
