import type {
  CommandContext,
  SlashCommandHandler,
} from '../commands/command-result';
import type { SubagentRunner } from './subagent-runner.service';
import type { Delegation } from './delegation.repository';
import { registerSubagentCommands } from './subagent-commands';

function delegation(overrides: Partial<Delegation> = {}): Delegation {
  return {
    id: 'task-1',
    parentSessionId: 'parent-1',
    childSessionId: 'child-1',
    parentRunId: null,
    goal: 'research widgets',
    state: 'completed',
    resultSummary: 'found three suppliers',
    error: null,
    cancelRequested: false,
    budgets: { maxIterations: 5, maxToolSteps: 5, maxTurnDurationMs: 300000 },
    createdAt: 't',
    updatedAt: 't',
    ...overrides,
  };
}

function build(runner: Partial<SubagentRunner>): SlashCommandHandler {
  const handlers: SlashCommandHandler[] = [];
  registerSubagentCommands((h) => handlers.push(h), {
    runner: runner as SubagentRunner,
  });
  const handler = handlers[0];
  if (!handler) throw new Error('agents command not registered');
  return handler;
}

const ctx: CommandContext = { sessionId: 'parent-1', raw: '/agents' };

describe('/agents', () => {
  it('lists delegations for the session', async () => {
    const handler = build({
      list: () => Promise.resolve([delegation(), delegation({ id: 'task-2' })]),
    });
    const result = await handler.execute(ctx, ['list']);
    expect(result.kind).toBe('data');
    expect(result.text).toContain('task-1'.slice(0, 8));
    expect(result.text).toContain('[completed]');
    expect(result.data).toEqual({ delegations: ['task-1', 'task-2'] });
  });

  it('reports an empty session honestly', async () => {
    const handler = build({
      list: () => Promise.resolve([]),
    });
    const result = await handler.execute(ctx, []);
    expect(result.kind).toBe('message');
    expect(result.text).toContain('No delegated');
  });

  it('shows status for one delegation', async () => {
    const handler = build({
      status: () => Promise.resolve(delegation()),
    });
    const result = await handler.execute(ctx, ['status', 'task-1']);
    expect(result.kind).toBe('data');
    expect(result.data).toEqual({ taskId: 'task-1', state: 'completed' });
  });

  it('reports unknown tasks without throwing', async () => {
    const handler = build({
      status: () => Promise.resolve(null),
      cancel: () => Promise.resolve(null),
    });
    expect((await handler.execute(ctx, ['status', 'nope'])).data).toEqual({
      taskId: 'nope',
      state: 'unknown_task',
    });
    expect((await handler.execute(ctx, ['cancel', 'nope'])).data).toEqual({
      taskId: 'nope',
      state: 'unknown_task',
    });
  });

  it('cancels a running delegation', async () => {
    const handler = build({
      cancel: () =>
        Promise.resolve(delegation({ state: 'running', resultSummary: null })),
    });
    const result = await handler.execute(ctx, ['cancel', 'task-1']);
    expect(result.text).toContain('Cancellation requested');
  });

  it('states the obvious for already-terminal delegations', async () => {
    const handler = build({
      cancel: () => Promise.resolve(delegation()),
    });
    const result = await handler.execute(ctx, ['cancel', 'task-1']);
    expect(result.text).toContain('already completed');
  });

  it('rejects bad usage and missing sessions', async () => {
    const handler = build({});
    await expect(handler.execute(ctx, ['bogus'])).rejects.toThrow(
      'Usage: /agents',
    );
    await expect(handler.execute(ctx, ['status'])).rejects.toThrow(
      'Usage: /agents status',
    );
    await expect(
      handler.execute({ sessionId: undefined, raw: '/agents' }, ['list']),
    ).rejects.toThrow();
  });
});
