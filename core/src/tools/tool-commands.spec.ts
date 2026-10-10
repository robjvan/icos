import type { CoreConfig } from '../config';
import type {
  CommandContext,
  SlashCommandHandler,
} from '../commands/command-result';
import { ToolRegistry } from './tool-registry';
import { ToolPullStore } from './tool-pull.store';
import { ToolSurfaceService } from './tool-surface.service';
import { registerToolCommands } from './tool-commands';

function build(overrides: Partial<CoreConfig> = {}): {
  handler: SlashCommandHandler;
  surface: ToolSurfaceService;
} {
  const config = {
    toolsDiscoveryEnabled: true,
    toolsAlwaysOn: ['memory', 'todo'],
    toolsMaxPerTurn: 6,
    toolsDiscoveryLimit: 8,
    toolsPullMaxResults: 5,
    toolsPullMaxPerTurn: 2,
    ...overrides,
  } as unknown as CoreConfig;
  const surface = new ToolSurfaceService(
    config,
    new ToolRegistry(),
    new ToolPullStore(),
  );
  const handlers: SlashCommandHandler[] = [];
  registerToolCommands((h) => handlers.push(h), { surface });
  return { handler: handlers[0], surface };
}

const ctx: CommandContext = { sessionId: 's1', raw: '/tools' };

describe('/tools', () => {
  it('lists the policy-enabled universe', async () => {
    const { handler } = build();
    const result = await handler.execute(ctx, ['list']);
    expect(result.kind).toBe('data');
    expect(result.text).toContain('policy-enabled');
    expect((result.data?.tools as unknown[]).length).toBeGreaterThan(0);
  });

  it('reports status with the bounds', async () => {
    const { handler } = build();
    const result = await handler.execute(ctx, ['status']);
    expect(result.kind).toBe('data');
    expect(result.data).toMatchObject({ discoveryEnabled: true });
  });

  it('stages matching tools for the next turn', async () => {
    const { handler, surface } = build();
    const result = await handler.execute(ctx, ['pull', 'read', 'file']);
    expect(result.kind).toBe('data');
    expect(result.data?.pulled).toContain('read_file');
    // Staged (pending) — not active until the next turn begins.
    expect(surface.injected('s1', '').allowedTools).not.toContain('read_file');
  });

  it('reports no match without staging', async () => {
    const { handler } = build();
    const result = await handler.execute(ctx, ['pull', 'zzzzzz']);
    expect(result.kind).toBe('message');
    expect(result.data?.pulled).toEqual([]);
  });

  it('clears staged pulls', async () => {
    const { handler } = build();
    await handler.execute(ctx, ['pull', 'read file']);
    const cleared = await handler.execute(ctx, ['clear']);
    expect(cleared.kind).toBe('message');
  });
});
