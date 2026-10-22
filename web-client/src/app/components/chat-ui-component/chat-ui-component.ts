import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  afterRenderEffect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { LucideArrowDown, LucidePlus, LucideTrash2 } from '@lucide/angular';
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
    LucideArrowDown,
    LucidePlus,
    LucideTrash2,
  ],
  templateUrl: './chat-ui-component.html',
  styleUrl: './chat-ui-component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatUiComponent implements OnInit {
  /** Distance from the bottom (px) that still counts as "at the live edge". */
  private static readonly STICK_SLOP_PX = 8;

  readonly store = inject(ConversationStore);
  private readonly realtime = inject(RealtimeService);
  private readonly contextApi = inject(ContextService);
  private readonly scrollHost = viewChild<ElementRef<HTMLElement>>('scrollHost');
  private readonly composer = viewChild(Composer);
  /**
   * True while the transcript follows the newest message (GH23). The reader
   * leaves by scrolling up — by any amount — and rejoins by scrolling back to
   * the bottom or pressing "Jump to latest".
   */
  readonly pinnedToBottom = signal(true);
  private lastScrollTop = 0;
  /** Last `scrollTop` we wrote ourselves — its scroll event is not user intent. */
  private lastWrittenTop = -1;
  /** True once the reader has moved since that write, so landing back on it counts. */
  private readerMovedSinceWrite = false;
  private lastPinnedScrollHeight = -1;
  private lastPinnedClientHeight = -1;
  private lastTouchY: number | null = null;
  /** Inline confirm for the deliberate, open-session-only delete (M20i). */
  readonly pendingDelete = signal(false);
  /** Live context usage for the header gauge (FG9c). */
  readonly usage = signal<{ used: number | null; budget: number; trigger: number }>(
    { used: null, budget: 0, trigger: 0 },
  );

  constructor() {
    // Auto-scroll has to run *after* the DOM update, keyed to the signals that
    // change the transcript's height. `ngAfterViewChecked` looked like the
    // right hook but is not emitted for every committed-message render in a
    // zoneless OnPush tree, so the view silently stopped following the turn.
    afterRenderEffect(() => {
      this.store.messages();
      this.store.pendingText();
      this.store.pendingTyping();
      this.stickToBottom();
    });
  }

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

  /** Follow the live turn, but only while pinned (GH23). */
  private stickToBottom(): void {
    const host = this.scrollHost()?.nativeElement;
    if (!host || !this.pinnedToBottom()) {
      return;
    }
    // Guarding on the scrollport geometry keeps an unchanged transcript from
    // re-writing `scrollTop` on every render.
    if (
      host.scrollHeight === this.lastPinnedScrollHeight &&
      host.clientHeight === this.lastPinnedClientHeight
    ) {
      return;
    }
    this.writeBottom(host);
  }

  /**
   * Direction wins over distance: a trackpad gesture moves 10–20 px per event,
   * so any upward movement releases the pin even though it is far inside the
   * old 48 px slop. Coming back within a few pixels of the bottom re-arms it.
   */
  onScroll(event: Event): void {
    const host = event.target as HTMLElement;
    const top = host.scrollTop;
    // Our own bottom-write landing. Scroll events are dispatched at frame
    // time, so the turn may have grown since the write: judging "distance
    // from bottom" here would wrongly release the pin and leave the reader
    // a screen short of the newest message.
    if (!this.readerMovedSinceWrite && Math.abs(top - this.lastWrittenTop) <= 1) {
      this.lastScrollTop = top;
      return;
    }
    // Any position we did not write is the reader's own movement.
    this.readerMovedSinceWrite = true;
    if (top < this.lastScrollTop - 0.5) {
      this.pinnedToBottom.set(false);
    } else {
      this.pinnedToBottom.set(this.distanceFromBottom(host) <= ChatUiComponent.STICK_SLOP_PX);
    }
    this.lastScrollTop = top;
  }

  /**
   * Release the pin synchronously on upward intent. Scroll events are
   * dispatched at frame time, so a token arriving in between would otherwise
   * re-stick the view before the scroll handler ever saw the gesture.
   */
  onWheel(event: WheelEvent): void {
    if (event.deltaY < 0) {
      this.readerMovedSinceWrite = true;
      this.pinnedToBottom.set(false);
    }
  }

  onTouchStart(event: TouchEvent): void {
    this.lastTouchY = event.touches[0]?.clientY ?? null;
  }

  /** Finger down (clientY increasing) scrolls the content up — release the pin. */
  onTouchMove(event: TouchEvent): void {
    const y = event.touches[0]?.clientY;
    if (y === undefined) {
      return;
    }
    if (this.lastTouchY !== null && y > this.lastTouchY + 1) {
      this.readerMovedSinceWrite = true;
      this.pinnedToBottom.set(false);
    }
    this.lastTouchY = y;
  }

  /** Jump to the live edge and resume following it ("Jump to latest"). */
  scrollToBottom(): void {
    this.pinnedToBottom.set(true);
    const host = this.scrollHost()?.nativeElement;
    if (!host) {
      return;
    }
    this.writeBottom(host);
  }

  private writeBottom(host: HTMLElement): void {
    host.scrollTop = host.scrollHeight;
    // Read back: the browser clamps, and the event will report this value.
    this.lastWrittenTop = host.scrollTop;
    this.readerMovedSinceWrite = false;
    this.rememberPinnedGeometry(host);
  }

  private distanceFromBottom(host: HTMLElement): number {
    return host.scrollHeight - host.scrollTop - host.clientHeight;
  }

  private rememberPinnedGeometry(host: HTMLElement): void {
    this.lastPinnedScrollHeight = host.scrollHeight;
    this.lastPinnedClientHeight = host.clientHeight;
    this.lastScrollTop = host.scrollTop;
  }

  /** Re-arm the pin for a transcript that is about to be replaced in full. */
  private reanchorToBottom(): void {
    this.pinnedToBottom.set(true);
    this.lastPinnedScrollHeight = -1;
    this.lastPinnedClientHeight = -1;
    this.lastScrollTop = 0;
    this.lastWrittenTop = -1;
    this.readerMovedSinceWrite = false;
  }

  openSession(id: string): void {
    // Defer a tick: focus must run after change detection re-enables the
    // composer and re-renders the transcript.
    this.reanchorToBottom();
    this.realtime.trackSession(id);
    void this.store
      .openSession(id)
      .finally(() => {
        void this.refreshUsage();
        setTimeout(() => this.focusComposer(), 0);
      });
  }

  startNewSession(): void {
    this.reanchorToBottom();
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
    // Sending is an explicit "take me to the live edge" — a reader who had
    // scrolled up should see their turn.
    this.reanchorToBottom();
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
