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
import { ConversationStore } from '../../services/conversation-store';
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
  private readonly scrollHost = viewChild<ElementRef<HTMLElement>>('scrollHost');
  private readonly composer = viewChild(Composer);
  private pinnedToBottom = true;
  /** Inline confirm for the deliberate, open-session-only delete (M20i). */
  readonly pendingDelete = signal(false);

  ngOnInit(): void {
    void this.store.refreshSessions();
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
      .finally(() => setTimeout(() => this.focusComposer(), 0));
  }

  startNewSession(): void {
    this.store.newSession();
    this.realtime.trackSession(null);
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
