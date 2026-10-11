import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { RunLimits } from '../agent/agent-run.repository';
import type { TurnOutcome } from './conversation.service';
import { ConversationService } from './conversation.service';
import type { ChildTurnRunner } from '../subagents/child-turn.port';

/**
 * M21.2: the conversation loop behind the child-turn port. Thin adapter —
 * child turns run the exact same loop as any other turn, under the
 * delegation's budgets (threaded via `converse` options since M21.1).
 *
 * The service is resolved lazily (the cron scheduler sets this precedent):
 * wiring it directly would close a construction cycle (adapter → service →
 * dispatcher → runner → port → adapter).
 */
@Injectable()
export class ConversationTurnAdapter implements ChildTurnRunner {
  constructor(private readonly moduleRef: ModuleRef) {}

  converse(
    message: string,
    sessionId: string | undefined,
    options: { limits: RunLimits },
  ): Promise<TurnOutcome> {
    return this.moduleRef
      .get(ConversationService, { strict: false })
      .converse(message, sessionId, options);
  }
}
