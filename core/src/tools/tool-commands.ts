import { BadRequestException } from '@nestjs/common';
import type {
  CommandContext,
  CommandResult,
  SlashCommandHandler,
} from '../commands/command-result';
import { requireSessionId } from '../commands/session-commands';
import type { ToolSurfaceService } from './tool-surface.service';

export interface ToolCommandDeps {
  surface: ToolSurfaceService;
}

/**
 * `/tools` (M20.7.2): inspect the tool surface and pull tools into context.
 * A pull stages tool **names** for the next turn — discoverability, not
 * authorization: the tools are already policy-enabled, and their calls still
 * validate + approve normally. No LLM contact.
 */
class ToolsCommand implements SlashCommandHandler {
  readonly name = 'tools';
  readonly description =
    'Inspect the tool surface and pull tools into context. No LLM contact.';
  constructor(private readonly deps: ToolCommandDeps) {}

  execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const [sub, ...rest] = args;
    if (!sub) return Promise.resolve(this.status(context));
    switch (sub.toLowerCase()) {
      case 'list':
        return Promise.resolve(this.list());
      case 'status':
        return Promise.resolve(this.status(context));
      case 'pull':
        return Promise.resolve(this.pull(context, rest));
      case 'clear':
        return Promise.resolve(this.clear(context));
      default:
        throw new BadRequestException(
          'Usage: /tools [list | status | pull <query> | clear]',
        );
    }
  }

  private list(): CommandResult {
    const universe = this.deps.surface.universe();
    return {
      kind: 'data',
      text: [
        `Tools (${universe.length} policy-enabled):`,
        ...universe.map((tool) => `- ${tool.name} [${tool.toolset}]`),
      ].join('\n'),
      data: {
        count: universe.length,
        tools: universe.map((tool) => ({
          name: tool.name,
          toolset: tool.toolset,
        })),
      },
    };
  }

  private status(context: CommandContext): CommandResult {
    const surface = this.deps.surface;
    const universe = surface.universe();
    const bounds = surface.bounds();
    const lines = [
      `Tools: ${universe.length} policy-enabled.`,
      `Discovery: ${surface.discoveryEnabled ? 'on' : 'off'} · max ${bounds.maxPerTurn}/turn · discovery limit ${bounds.discoveryLimit}`,
      `Pull: up to ${bounds.pullMaxResults}/call · ${bounds.pullMaxPerTurn}/turn`,
      `Always-on: ${bounds.alwaysOn.join(', ') || 'none'}`,
    ];
    if (context.sessionId) {
      const injected = surface.injected(context.sessionId, '');
      lines.push(`Injected this turn: ${injected.descriptors.length}`);
    }
    return {
      kind: 'data',
      text: lines.join('\n'),
      data: {
        universe: universe.length,
        discoveryEnabled: surface.discoveryEnabled,
        bounds,
      },
    };
  }

  private pull(context: CommandContext, args: string[]): CommandResult {
    const sessionId = requireSessionId(context, 'tools pull');
    const query = args.join(' ').trim();
    if (!query) {
      throw new BadRequestException('Usage: /tools pull <query>');
    }
    const matches = this.deps.surface.discover(query);
    if (matches.length === 0) {
      return {
        kind: 'message',
        text: `No tools match "${query}". Try different words.`,
        data: { pulled: [] },
      };
    }
    const names = matches.map((match) => match.tool.name);
    this.deps.surface.stagePull(sessionId, names);
    return {
      kind: 'data',
      text: [
        `Pulled ${names.length} tool(s) for the next turn:`,
        ...names.map((name) => `- ${name}`),
      ].join('\n'),
      data: { pulled: names },
    };
  }

  private clear(context: CommandContext): CommandResult {
    const sessionId = requireSessionId(context, 'tools clear');
    this.deps.surface.clear(sessionId);
    return {
      kind: 'message',
      text: 'Cleared staged tool pulls for this session.',
      data: { cleared: true },
    };
  }
}

export function registerToolCommands(
  register: (handler: SlashCommandHandler) => void,
  deps: ToolCommandDeps,
): void {
  register(new ToolsCommand(deps));
}
