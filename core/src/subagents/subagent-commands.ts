import { BadRequestException } from '@nestjs/common';
import type {
  CommandContext,
  CommandResult,
  SlashCommandHandler,
} from '../commands/command-result';
import { requireSessionId } from '../commands/session-commands';
import type { SubagentRunner } from './subagent-runner.service';
import type { Delegation } from './delegation.repository';

export interface SubagentCommandDeps {
  runner: SubagentRunner;
}

function formatLine(delegation: Delegation): string {
  const short = delegation.id.slice(0, 8);
  const extra =
    delegation.state === 'completed' && delegation.resultSummary
      ? ` — ${delegation.resultSummary.slice(0, 160)}`
      : delegation.state === 'failed'
        ? ` — ${delegation.error ?? 'unknown error'}`
        : '';
  return `- ${short} [${delegation.state}] ${delegation.goal}${extra}`;
}

/**
 * `/agents` (M21.2): inspect and cancel delegated subagent tasks for the
 * current session. Read + cooperative cancel only — spawning stays with the
 * `delegate_task` tool. No LLM contact.
 */
class AgentsCommand implements SlashCommandHandler {
  readonly name = 'agents';
  readonly description =
    'List, inspect, and cancel delegated subagent tasks. No LLM contact.';
  constructor(private readonly deps: SubagentCommandDeps) {}

  async execute(
    context: CommandContext,
    args: string[],
  ): Promise<CommandResult> {
    const [sub, ...rest] = args;
    if (!sub) return this.list(context);
    switch (sub.toLowerCase()) {
      case 'list':
        return this.list(context);
      case 'status':
        return this.status(context, rest);
      case 'cancel':
        return this.cancel(context, rest);
      default:
        throw new BadRequestException(
          'Usage: /agents [list | status <task-id> | cancel <task-id>]',
        );
    }
  }

  private async list(context: CommandContext): Promise<CommandResult> {
    const sessionId = requireSessionId(context, 'agents list');
    const items = await this.deps.runner.list(sessionId);
    if (items.length === 0) {
      return {
        kind: 'message',
        text: 'No delegated subagent tasks for this session.',
        data: { delegations: [] },
      };
    }
    return {
      kind: 'data',
      text: [
        `Delegated tasks (${items.length}):`,
        ...items.map(formatLine),
      ].join('\n'),
      data: { delegations: items.map((d) => d.id) },
    };
  }

  private async status(
    context: CommandContext,
    args: string[],
  ): Promise<CommandResult> {
    requireSessionId(context, 'agents status');
    const [taskId] = args;
    if (!taskId) {
      throw new BadRequestException('Usage: /agents status <task-id>');
    }
    const record = await this.deps.runner.status(taskId);
    if (!record) {
      return {
        kind: 'message',
        text: `Unknown delegation "${taskId}".`,
        data: { taskId, state: 'unknown_task' },
      };
    }
    return {
      kind: 'data',
      text: formatLine(record),
      data: { taskId: record.id, state: record.state },
    };
  }

  private async cancel(
    context: CommandContext,
    args: string[],
  ): Promise<CommandResult> {
    requireSessionId(context, 'agents cancel');
    const [taskId] = args;
    if (!taskId) {
      throw new BadRequestException('Usage: /agents cancel <task-id>');
    }
    const record = await this.deps.runner.cancel(taskId);
    if (!record) {
      return {
        kind: 'message',
        text: `Unknown delegation "${taskId}".`,
        data: { taskId, state: 'unknown_task' },
      };
    }
    return {
      kind: 'message',
      text:
        record.state === 'cancelled' ||
        record.state === 'completed' ||
        record.state === 'failed' ||
        record.state === 'budget_exhausted'
          ? `Delegation ${record.id.slice(0, 8)} is already ${record.state}.`
          : `Cancellation requested for delegation ${record.id.slice(0, 8)} — the child terminates truthfully.`,
      data: { taskId: record.id, state: record.state },
    };
  }
}

export function registerSubagentCommands(
  register: (handler: SlashCommandHandler) => void,
  deps: SubagentCommandDeps,
): void {
  register(new AgentsCommand(deps));
}
