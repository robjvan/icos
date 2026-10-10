import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { LlmClient } from '../llm/llm.client';
import type { ChatMessage } from '../llm/llm.client';
import { MEMORY_LLM_CLIENT } from '../memory/llm-memory-candidate-extractor';
import { SessionStore } from './session.store';
import type { ContextSummary } from '../session/session.repository';
import { ContextBudgetService, estimateText } from './context-budget.service';

/** Newest messages never folded into the summary (continuity floor). */
const KEEP_RECENT_MESSAGES = 8;
/** Cap on the folded transcript sent to the summarizer (chars). */
const MAX_TRANSCRIPT_CHARS = 60_000;
/** Cap on the stored summary (chars). */
const MAX_SUMMARY_CHARS = 8_000;

const SUMMARIZE_SYSTEM_PROMPT =
  'You compress a conversation transcript into a compact briefing for the ' +
  'assistant that continues the conversation. Preserve decisions, user ' +
  'preferences and facts, open questions, file paths and identifiers, and any ' +
  'commitments. Drop pleasantries and redundant back-and-forth. Write plain ' +
  'prose or bullets with no preamble.';

export interface CompactionResult {
  summary: string;
  coveredUptoMessageId: number;
  tokenEstimate: number;
  summarizedMessages: number;
}

/**
 * M20.6.2 context compaction. Folds the older turns of a session into a
 * rolling summary (one row per session), keeping the newest turns verbatim and
 * never re-summarizing an already-covered range. The transcript is untouched —
 * compaction is context-only. Summarization uses the memory role when
 * configured, else the conversation model.
 */
@Injectable()
export class ContextCompactionService {
  private readonly logger = new Logger(ContextCompactionService.name);

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly sessions: SessionStore,
    private readonly budget: ContextBudgetService,
    private readonly llm: LlmClient,
    @Optional()
    @Inject(MEMORY_LLM_CLIENT)
    private readonly memoryLlm?: LlmClient,
  ) {}

  /** The stored rolling summary for a session, or null. */
  async summaryFor(sessionId: string): Promise<ContextSummary | null> {
    return this.sessions.getContextSummary(sessionId);
  }

  /**
   * Fold older turns into the rolling summary. Returns null when there is
   * nothing new to fold (fewer than KEEP_RECENT_MESSAGES + 1, or the range is
   * already covered). Throws on summarizer failure — the caller decides
   * whether to degrade.
   */
  async compact(sessionId: string): Promise<CompactionResult | null> {
    const records = (await this.sessions.getMessageRecords(sessionId)).filter(
      (record) => !record.excludedFromContext,
    );
    const existing = await this.sessions.getContextSummary(sessionId);
    const coveredUpto = existing?.coveredUptoMessageId ?? 0;
    const foldable = records.filter((record) => record.id > coveredUpto);
    // Never split a turn: end the fold at a user-message boundary (turns start
    // with a user message), so tool-call/result sequences stay whole.
    let end = Math.max(0, foldable.length - KEEP_RECENT_MESSAGES);
    while (end > 0 && foldable[end].role !== 'user') end -= 1;
    const toFold = foldable.slice(0, end);
    if (toFold.length === 0) return null;

    const transcript = toFold
      .map((record) => `${record.role}: ${record.content}`)
      .join('\n')
      .slice(0, MAX_TRANSCRIPT_CHARS);
    const prior = existing ? `Existing summary:\n${existing.summary}\n\n` : '';
    const client = this.memoryLlm ?? this.llm;
    const result = await client.chat({
      messages: [
        { role: 'system', content: SUMMARIZE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `${prior}New transcript to fold in:\n${transcript}`,
        },
      ],
    });
    const summary = result.content.trim().slice(0, MAX_SUMMARY_CHARS);
    if (!summary) return null;

    const coveredUptoMessageId = toFold[toFold.length - 1].id;
    const tokenEstimate = estimateText(summary);
    await this.sessions.upsertContextSummary({
      sessionId,
      summary,
      coveredUptoMessageId,
      tokenEstimate,
    });
    this.logger.log(
      `Compacted session ${sessionId}: ${toFold.length} message(s) -> ${tokenEstimate} tokens`,
    );
    return {
      summary,
      coveredUptoMessageId,
      tokenEstimate,
      summarizedMessages: toFold.length,
    };
  }

  /**
   * Turn hook: compact when the assembled context crosses the budget trigger.
   * Fail-soft — a summarizer error is logged and the un-compacted context is
   * used. Returns the new summary or null when nothing happened.
   */
  async compactIfNeeded(
    sessionId: string,
    assembled: readonly ChatMessage[],
  ): Promise<ContextSummary | null> {
    if (!this.budget.shouldCompact(assembled)) return null;
    try {
      const result = await this.compact(sessionId);
      if (!result) return null;
      return this.sessions.getContextSummary(sessionId);
    } catch (err) {
      this.logger.warn(
        `Context compaction failed for ${sessionId}: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
      );
      return null;
    }
  }

  /** The resolved summarizer model name (for `/status` / `/compact`). */
  summarizerLabel(): string {
    return this.memoryLlm ? this.config.memoryLlmModel : this.config.llmModel;
  }
}
