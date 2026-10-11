import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import type { TurnOutcome } from '../conversation/conversation.service';
import { SessionStore } from '../conversation/session.store';
import { ToolSurfaceService } from '../tools/tool-surface.service';
import type { ChildTurnRunner } from './child-turn.port';
import { CHILD_TURN_RUNNER } from './child-turn.port';
import { AgentRunRepository } from '../agent/agent-run.repository';
import { DelegationRepository } from './delegation.repository';
import type { Delegation, DelegationBudgets } from './delegation.repository';

export interface SpawnInput {
  parentSessionId: string;
  parentRunId?: string | null;
  goal: string;
  context?: string;
  /** M21.2 capability narrowing (intersected with operator policy). */
  toolsets?: string[];
  /** M21.2 capability narrowing (added to the toolset selection). */
  tools?: string[];
}

export type SpawnResult =
  { spawned: true; taskId: string } | { spawned: false; reason: string };

const TERMINAL_STATES = new Set([
  'completed',
  'failed',
  'cancelled',
  'budget_exhausted',
]);

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The child's opening message: goal + explicit context, nothing inherited. */
export function buildChildMessage(
  goal: string,
  context: string | null,
): string {
  const lines = [
    '[Subagent task — this is an isolated child session. Work here only, then end with a concise summary of what you did and the key result.]',
    `Goal: ${goal}`,
    `Context: ${context ?? '(none provided)'}`,
  ];
  return lines.join('\n');
}

/** Bound a child summary so a verbose child cannot flood the parent. */
export function truncateSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} chars]`;
}

/**
 * M21.1 async subagent runner. Spawning writes the delegation record and
 * launches the child turn as a detached background promise — the parent is
 * never awaited on. Every exit path (completed / parked / failed / cancelled
 * / budget-exhausted / restart) lands in the delegation record; a rejection
 * must never escape into the parent or crash the process.
 *
 * Child turns run through the injected child-turn port (M21.2): same loop,
 * delegation budgets. The port exists because a direct dependency would
 * close a construction cycle (dispatcher → runner → conversation →
 * dispatcher).
 */
@Injectable()
export class SubagentRunner implements OnModuleInit {
  private readonly logger = new Logger(SubagentRunner.name);
  private inFlight = 0;

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly delegations: DelegationRepository,
    private readonly sessions: SessionStore,
    private readonly runs: AgentRunRepository,
    private readonly surface: ToolSurfaceService,
    @Inject(CHILD_TURN_RUNNER) private readonly turns: ChildTurnRunner,
  ) {}

  onModuleInit(): void {
    // Honest restart recovery: the background promises are gone, so every
    // non-terminal delegation is failed rather than left dangling. An
    // approval decided afterwards resumes nothing (see the delegation
    // record's error) — the operator re-delegates instead.
    void this.delegations.failNonTerminal('restart').then((ids) => {
      if (ids.length > 0) {
        this.logger.warn(
          `Marked ${ids.length} orphaned delegation(s) failed after restart.`,
        );
      }
    });
  }

  get enabled(): boolean {
    return this.config.subagentsEnabled !== false;
  }

  budgets(): DelegationBudgets {
    return {
      maxIterations: this.config.subagentMaxIterations ?? 5,
      maxToolSteps: this.config.subagentMaxToolSteps ?? 5,
      maxTurnDurationMs: this.config.subagentMaxTurnDurationMs ?? 5 * 60 * 1000,
    };
  }

  resultMaxChars(): number {
    return this.config.subagentResultMaxChars ?? 4000;
  }

  maxConcurrent(): number {
    return this.config.subagentMaxConcurrent ?? 4;
  }

  async spawn(input: SpawnInput): Promise<SpawnResult> {
    if (!this.enabled) {
      return {
        spawned: false,
        reason: 'Subagent delegation is disabled (SUBAGENTS_ENABLED=false).',
      };
    }
    if (this.inFlight >= this.maxConcurrent()) {
      return {
        spawned: false,
        reason: `Concurrency cap reached (${this.maxConcurrent()} running).`,
      };
    }
    // Synchronous increment before the first await: two racing spawns cannot
    // both slip past the cap. Decremented by run(), or here on refusal.
    this.inFlight += 1;
    let launched = false;
    try {
      // Flat-only: a child session cannot delegate further (M21 decision).
      if (await this.delegations.isChildSession(input.parentSessionId)) {
        return {
          spawned: false,
          reason: 'A delegated child cannot delegate further.',
        };
      }
      const goal = input.goal.trim();
      if (!goal) {
        return { spawned: false, reason: 'A non-empty goal is required.' };
      }
      const { id: childSessionId } = await this.sessions.resolve(undefined);
      let record: Delegation;
      try {
        record = await this.delegations.create({
          parentSessionId: input.parentSessionId,
          childSessionId,
          parentRunId: input.parentRunId ?? null,
          goal,
          budgets: this.budgets(),
        });
      } catch (err) {
        // Tidy the orphan: a child session with no delegation is confusing
        // in the session list and has no provenance.
        await this.sessions.deleteSession(childSessionId);
        throw err;
      }
      this.logger.log(
        `Delegated "${goal.slice(0, 80)}" -> ${record.id} (child session ${childSessionId}).`,
      );
      // Set the capability overlay synchronously before launching: the
      // child's first roundTools must already see the narrowed universe —
      // an await between record creation and launch would race it.
      const restriction = {
        ...(input.toolsets !== undefined ? { toolsets: input.toolsets } : {}),
        ...(input.tools !== undefined ? { tools: input.tools } : {}),
      };
      this.surface.setOverlay(childSessionId, restriction);
      const admitted = this.surface.universe(childSessionId).length;
      if (
        ((restriction.toolsets?.length ?? 0) > 0 ||
          (restriction.tools?.length ?? 0) > 0) &&
        admitted === 0
      ) {
        this.logger.warn(
          `Delegation ${record.id} narrowed to zero tools — the child can only answer from context.`,
        );
      }
      launched = true;
      void this.run(record.id, input.context?.trim() || null);
      return { spawned: true, taskId: record.id };
    } finally {
      if (!launched) this.inFlight -= 1;
    }
  }

  /**
   * Read a delegation, reconciling parked children onto their run's terminal
   * state first (an approval decided while detached finishes the child run
   * through the normal resume path — nobody else updates this record).
   */
  async status(taskId: string): Promise<Delegation | null> {
    const record = await this.delegations.get(taskId);
    if (!record || TERMINAL_STATES.has(record.state)) return record;
    return this.reconcile(record);
  }

  /**
   * List a session's delegations, newest first, reconciling the
   * non-terminal ones (bounded — a burst of delegations stays cheap).
   */
  async list(parentSessionId: string, limit = 20): Promise<Delegation[]> {
    const items = await this.delegations.listByParent(parentSessionId);
    const out: Delegation[] = [];
    for (const item of items.slice(0, Math.max(0, limit))) {
      out.push(
        TERMINAL_STATES.has(item.state) ? item : await this.reconcile(item),
      );
    }
    return out;
  }

  /** Cooperative cancel: the child loop observes the flag and terminates. */
  async cancel(taskId: string): Promise<Delegation | null> {
    return this.delegations.requestCancel(taskId);
  }

  private async run(taskId: string, context: string | null): Promise<void> {
    try {
      const record = await this.delegations.get(taskId);
      if (!record || TERMINAL_STATES.has(record.state)) return;
      if (record.cancelRequested) {
        await this.delegations.setState(taskId, 'cancelled');
        return;
      }
      if (!record.childSessionId) {
        await this.delegations.setState(taskId, 'failed', {
          error: 'Delegation has no child session.',
        });
        return;
      }
      const outcome = await this.turns.converse(
        buildChildMessage(record.goal, context),
        record.childSessionId,
        { limits: record.budgets },
      );
      // Re-read before settling: a restart or cancel may have terminalized
      // the record while the turn was in flight. First terminal wins; a late
      // settle must never clobber it (e.g. completed over failed-restart).
      const current = await this.delegations.get(taskId);
      if (!current || TERMINAL_STATES.has(current.state)) return;
      await this.settle(taskId, outcome);
    } catch (err) {
      // Background-promise discipline: a child failure is a record, never
      // a throw into the parent or the process.
      await this.delegations
        .setState(taskId, 'failed', { error: message(err) })
        .catch((storeErr) =>
          this.logger.error(
            `Delegation ${taskId} failed and the failure could not be recorded: ${message(storeErr)}`,
          ),
        );
    } finally {
      // Parked children hold no compute: the slot frees when the background
      // promise returns, terminal or parked alike.
      this.inFlight -= 1;
    }
  }

  private async settle(taskId: string, outcome: TurnOutcome): Promise<void> {
    if (outcome.outcome === 'cancelled') {
      await this.delegations.setState(taskId, 'cancelled');
      return;
    }
    switch (outcome.status) {
      case 'ok':
        await this.delegations.setState(taskId, 'completed', {
          resultSummary: truncateSummary(outcome.reply, this.resultMaxChars()),
        });
        return;
      case 'approval_required':
      case 'clarification_required':
        // Parked on operator input: the normal approval/clarification UX
        // resumes (or denies) the child; status() reconciles the record
        // onto the run's terminal state afterwards. The two park kinds
        // share one delegation state — both mean "blocked on the operator".
        await this.delegations.setState(taskId, 'awaiting_approval');
        return;
      case 'processing':
        // A background tool owns the rest of this turn through existing
        // machinery; the delegation stays running until status()
        // reconciles it onto the terminal run state.
        return;
    }
  }

  private async reconcile(record: Delegation): Promise<Delegation> {
    if (!record.childSessionId) return record;
    const latest = this.runs.latestRun(record.childSessionId);
    if (
      !latest ||
      (latest.state !== 'completed' &&
        latest.state !== 'failed' &&
        latest.state !== 'cancelled' &&
        latest.state !== 'budget_exhausted')
    ) {
      return record;
    }
    switch (latest.state) {
      case 'completed': {
        const summary = await this.lastAssistantMessage(record.childSessionId);
        const updated = await this.delegations.setState(
          record.id,
          'completed',
          {
            resultSummary: truncateSummary(
              summary ?? '(no assistant reply recorded)',
              this.resultMaxChars(),
            ),
          },
        );
        return updated ?? record;
      }
      case 'failed':
        return (
          (await this.delegations.setState(record.id, 'failed', {
            error: latest.termination?.reason ?? 'child run failed',
          })) ?? record
        );
      case 'cancelled':
        return (
          (await this.delegations.setState(record.id, 'cancelled')) ?? record
        );
      case 'budget_exhausted':
        return (
          (await this.delegations.setState(record.id, 'budget_exhausted')) ??
          record
        );
    }
  }

  private async lastAssistantMessage(
    sessionId: string,
  ): Promise<string | null> {
    const messages = await this.sessions.getContextMessages(sessionId);
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].content.trim()) {
        return messages[i].content;
      }
    }
    return null;
  }
}
