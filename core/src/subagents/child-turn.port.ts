import type { RunLimits } from '../agent/agent-run.repository';
import type { TurnOutcome } from '../conversation/conversation.service';

/**
 * M21.2: the seam through which the subagent runner drives child turns.
 * It keeps the `subagents` layer decoupled from the conversation
 * implementation — the runner depends on this interface, and the
 * conversation layer provides the implementation. (A direct dependency
 * would close a construction cycle: dispatcher → runner → conversation →
 * dispatcher. The cron scheduler's ModuleRef trick is the alternative;
 * an explicit port reads better and tests cheaper.)
 */
export const CHILD_TURN_RUNNER = 'CHILD_TURN_RUNNER';

export interface ChildTurnRunner {
  converse(
    message: string,
    sessionId: string | undefined,
    options: { limits: RunLimits },
  ): Promise<TurnOutcome>;
}
