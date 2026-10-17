import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { LucidePlus, LucideTrash2 } from '@lucide/angular';
import { ApprovalCard } from '../approval-card/approval-card';
import { Composer } from '../composer/composer';
import { MessageList } from '../message-list/message-list';
import { QuestionCard } from '../question-card/question-card';
import { SessionSidebar } from '../session-sidebar/session-sidebar';
import { ContextGauge } from '../context-gauge/context-gauge';
import { ConversationStore } from '../../services/conversation-store';
import { ContextService } from '../../services/context.service';
import type { ComposerSubmission } from '../../models/attachment';
import { RealtimeService } from '../../services/realtime.service';

/**
 * Chat shell: sidebar + transcript + approvals/questions + composer.
 * Owns scrolling and delegates all state to `ConversationStore`.
 */
@Component({
  selector: 'app-chat-ui-component',
  imports: [
    SessionSidebar,
    MessageList,
    ApprovalCard,
    QuestionCard,
    Composer,
    ContextGauge,
    LucidePlus,
    LucideTrash2,
  ],
  templateUrl: './chat-ui-component.html',
  styleUrl: './chat-ui-component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatUiComponent implements OnInit, AfterViewChecked {
  readonly store = inject(ConversationStore);
  private readonly realtime = inject(RealtimeService);
  private readonly contextApi = inject(ContextService);
  private readonly scrollHost = viewChild<ElementRef<HTMLElement>>('scrollHost');
  private readonly composer = viewChild(Composer);
  private pinnedToBottom = true;
  /** Inline confirm for the deliberate, open-session-only delete (M20i). */
  readonly pendingDelete = signal(false);
  /** Live context usage for the header gauge (FG9c). */
  readonly usage = signal<{ used: number | null; budget: number; trigger: number }>(
    { used: null, budget: 0, trigger: 0 },
  );

  ngOnInit(): void {
    void this.store.refreshSessions();
    void this.refreshUsage();
  }

  /** Best-effort context usage for the header gauge (FG9c). */
  async refreshUsage(): Promise<void> {
    const id = this.store.sessionId();
    if (!id) {
      this.usage.set({ used: null, budget: 0, trigger: 0 });
      return;
    }
    try {
      const result = await this.contextApi.usage(id);
      this.usage.set({
        used: result.usedTokens,
        budget: result.settings.usableTokens,
        trigger: result.settings.triggerTokens,
      });
    } catch {
      // Gauge is best-effort; keep the last value on failure.
    }
  }

  ngAfterViewChecked(): void {
    if (this.pinnedToBottom) {
      const host = this.scrollHost()?.nativeElement;
      if (host) {
        host.scrollTop = host.scrollHeight;
      }
    }
  }

  onScroll(event: Event): void {
    const host = event.target as HTMLElement;
    this.pinnedToBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 48;
  }

  openSession(id: string): void {
    // Defer a tick: focus must run after change detection re-enables the
    // composer and re-renders the transcript.
    this.realtime.trackSession(id);
    void this.store
      .openSession(id)
      .finally(() => {
        void this.refreshUsage();
        setTimeout(() => this.focusComposer(), 0);
      });
  }

  startNewSession(): void {
    this.store.newSession();
    this.realtime.trackSession(null);
    this.usage.set({ used: null, budget: 0, trigger: 0 });
    this.focusComposer();
  }

  requestDeleteSession(): void {
    this.pendingDelete.set(true);
  }

  cancelDeleteSession(): void {
    this.pendingDelete.set(false);
  }

  confirmDeleteSession(): void {
    const id = this.store.sessionId();
    this.pendingDelete.set(false);
    if (!id) {
      return;
    }
    void this.store.deleteSession(id);
  }

  sendMessage(submission: ComposerSubmission): void {
    // Refocus when the turn (including trailing refreshes) completes so the
    // next message starts from the keyboard. Busy-disable may drop focus
    // mid-turn; the finally covers the ready state.
    void this.store
      .sendMessage(submission)
      .finally(() => {
        // First turn assigns the session id via stream `meta` — track
        // whatever is current so room filtering follows.
        this.realtime.trackSession(this.store.sessionId());
        void this.refreshUsage();
        setTimeout(() => this.focusComposer(), 0);
      });
  }

  resolveApproval(event: { id: string; decision: 'approve' | 'reject' }): void {
    void this.store.resolveApproval(event.id, event.decision);
  }

  answerQuestion(event: { id: string; answer: string }): void {
    void this.store.answerQuestion(event.id, event.answer);
  }

  dismissQuestion(id: string): void {
    void this.store.cancelQuestion(id);
  }

  sessionLabel(): string {
    return this.store.sessionId() ?? 'new session';
  }

  private focusComposer(): void {
    this.composer()?.focusInput();
  }
}
