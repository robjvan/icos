import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { SubagentRunner } from './subagent-runner.service';

/**
 * Subagent delegation inspection (M21.2, read-only). Spawning stays with
 * the `delegate_task` tool and cancelling with `delegate_cancel` (or
 * `/agents cancel`); this surface exists for the Agents tab and other
 * read-only clients. No LLM contact, no mutations.
 */
@Controller('core/delegations')
export class DelegationsController {
  constructor(private readonly runner: SubagentRunner) {}

  @Get()
  async list(
    @Query('parentSessionId') parentSessionId?: string,
  ): Promise<{ delegations: unknown[] }> {
    if (!parentSessionId?.trim()) {
      throw new BadRequestException(
        'Usage: /core/delegations?parentSessionId=<id>',
      );
    }
    return { delegations: await this.runner.list(parentSessionId) };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<{ delegation: unknown }> {
    const record = await this.runner.status(id);
    if (!record) {
      throw new NotFoundException(`Unknown delegation "${id}".`);
    }
    return { delegation: record };
  }
}
