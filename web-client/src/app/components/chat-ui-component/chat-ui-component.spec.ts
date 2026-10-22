import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { vi } from 'vitest';

import { ChatUiComponent } from './chat-ui-component';
import { ConversationStore } from '../../services/conversation-store';
import type { ChatMessage } from '../../models/message';

/**
 * jsdom reports no layout, so the transcript's scrollport has to be faked.
 * `scrollTop` clamps to `scrollHeight - clientHeight` exactly as a browser
 * does — without that, the "own write arrives late" race cannot be modelled.
 */
function setScrollport(
  host: HTMLElement,
  geometry: { scrollHeight: number; clientHeight: number },
): void {
  const max = Math.max(0, geometry.scrollHeight - geometry.clientHeight);
  let value = Math.min(Math.max(host.scrollTop || 0, 0), max);

  Object.defineProperty(host, 'scrollHeight', {
    configurable: true,
    value: geometry.scrollHeight,
  });
  Object.defineProperty(host, 'clientHeight', {
    configurable: true,
    value: geometry.clientHeight,
  });
  Object.defineProperty(host, 'scrollTop', {
    configurable: true,
    get: () => value,
    set: (next: number) => {
      value = Math.min(Math.max(next, 0), max);
    },
  });
}

/** The scrollTop of the live edge for the current geometry. */
function bottomOf(host: HTMLElement): number {
  return host.scrollHeight - host.clientHeight;
}

describe('ChatUiComponent', () => {
  let component: ChatUiComponent;
  let fixture: ComponentFixture<ChatUiComponent>;
  let host: HTMLElement;

  /** The store's signals are real, so a token dirties the pane like it does live. */
  let pendingText: ReturnType<typeof signal<string | null>>;

  beforeEach(async () => {
    pendingText = signal<string | null>(null);

    const store = {
      sessionId: signal<string | null>(null),
      messages: signal<readonly ChatMessage[]>([]),
      busy: signal(false),
      sessions: signal([]),
      searchResults: signal(null),
      approvals: signal([]),
      clarifications: signal([]),
      pendingText,
      pendingTyping: signal(false),
      refreshSessions: vi.fn().mockResolvedValue(undefined),
      openSession: vi.fn().mockResolvedValue(undefined),
      newSession: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      resolveApproval: vi.fn(),
      answerQuestion: vi.fn(),
      cancelQuestion: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ChatUiComponent],
      providers: [
        provideRouter([]),
        { provide: ConversationStore, useValue: store },
        {
          provide: (await import('../../services/realtime.service')).RealtimeService,
          useValue: { trackSession: vi.fn(), resubscribe: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatUiComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    host = (fixture.nativeElement as HTMLElement).querySelector('.scroll-host') as HTMLElement;
  });

  /** A streamed token: the pending bubble grows, then the after-render pass runs. */
  async function token(): Promise<void> {
    pendingText.update((text) => `${text ?? ''}chunk`);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /** The reader's own scroll, followed by the event the browser dispatches. */
  async function readerScrollsTo(top: number): Promise<void> {
    host.scrollTop = top;
    host.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the shell regions', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-session-sidebar')).not.toBeNull();
    expect(compiled.querySelector('app-message-list')).not.toBeNull();
    expect(compiled.querySelector('app-composer')).not.toBeNull();
  });

  it('should label a null session as new', () => {
    expect(component.sessionLabel()).toBe('new session');
  });

  it('should track the session for realtime room filtering on open', async () => {
    const { RealtimeService } = await import('../../services/realtime.service');
    const realtime = TestBed.inject(RealtimeService) as unknown as {
      trackSession: ReturnType<typeof vi.fn>;
    };
    component.openSession('s1');
    expect(realtime.trackSession).toHaveBeenCalledWith('s1');
    component.startNewSession();
    expect(realtime.trackSession).toHaveBeenCalledWith(null);
  });

  describe('sticky bottom (GH23)', () => {
    it('follows the live edge while no one has scrolled away', async () => {
      setScrollport(host, { scrollHeight: 1000, clientHeight: 400 });
      await token();
      expect(host.scrollTop).toBe(bottomOf(host));
    });

    it('releases the pin on a trackpad-sized upward scroll and leaves the view alone', async () => {
      setScrollport(host, { scrollHeight: 1000, clientHeight: 400 });
      await token();

      // 15px up — a typical two-finger nudge, well inside the old 48px slop.
      await readerScrollsTo(585);
      expect(component.pinnedToBottom()).toBe(false);

      // A token arrives and the turn grows; the reader must keep their place.
      setScrollport(host, { scrollHeight: 1400, clientHeight: 400 });
      await token();
      expect(host.scrollTop).toBe(585);
    });

    it('re-arms the pin once the reader returns to the bottom', async () => {
      setScrollport(host, { scrollHeight: 1000, clientHeight: 400 });
      await token();

      await readerScrollsTo(300);
      expect(component.pinnedToBottom()).toBe(false);

      await readerScrollsTo(600); // scrollHeight - clientHeight: the live edge
      expect(component.pinnedToBottom()).toBe(true);

      setScrollport(host, { scrollHeight: 1350, clientHeight: 400 });
      await token();
      expect(host.scrollTop).toBe(bottomOf(host));
    });

    it('releases the pin on upward wheel intent before any scroll event fires', async () => {
      setScrollport(host, { scrollHeight: 1000, clientHeight: 400 });
      await token();

      // Scroll events are dispatched at frame time; a token can arrive first.
      host.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
      expect(component.pinnedToBottom()).toBe(false);

      setScrollport(host, { scrollHeight: 1600, clientHeight: 400 });
      await token();
      expect(host.scrollTop).toBe(600);
    });

    it('keeps following on a downward wheel', () => {
      host.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
      expect(component.pinnedToBottom()).toBe(true);
    });

    it('releases the pin when a touch drag scrolls back into history', () => {
      component.onTouchStart({ touches: [{ clientY: 300 }] } as unknown as TouchEvent);
      component.onTouchMove({ touches: [{ clientY: 240 }] } as unknown as TouchEvent);
      expect(component.pinnedToBottom()).toBe(true);

      component.onTouchMove({ touches: [{ clientY: 340 }] } as unknown as TouchEvent);
      expect(component.pinnedToBottom()).toBe(false);
    });

    it('offers jump-to-latest and resumes following when used', async () => {
      setScrollport(host, { scrollHeight: 1000, clientHeight: 400 });
      await token();
      await readerScrollsTo(200);

      const jump = (fixture.nativeElement as HTMLElement).querySelector(
        '.jump-btn',
      ) as HTMLButtonElement;
      expect(jump).not.toBeNull();
      expect(jump.textContent).toContain('Jump to latest');

      setScrollport(host, { scrollHeight: 1500, clientHeight: 400 });
      jump.click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.pinnedToBottom()).toBe(true);
      expect(host.scrollTop).toBe(bottomOf(host));
      expect((fixture.nativeElement as HTMLElement).querySelector('.jump-btn')).toBeNull();
    });

    it('ignores its own bottom write when the turn grows before the scroll event', async () => {
      setScrollport(host, { scrollHeight: 1000, clientHeight: 400 });
      await token(); // writes the bottom

      // The turn grows, then our own write's scroll event finally arrives.
      setScrollport(host, { scrollHeight: 1400, clientHeight: 400 });
      host.dispatchEvent(new Event('scroll'));
      expect(component.pinnedToBottom()).toBe(true);

      await token();
      expect(host.scrollTop).toBe(bottomOf(host));
    });

    it('does not re-write scrollTop when the transcript has not grown', async () => {
      setScrollport(host, { scrollHeight: 1000, clientHeight: 400 });
      await token();

      // Mid-gesture position, no scroll event yet: the render must not fight it.
      host.scrollTop = 400;
      await token();
      expect(host.scrollTop).toBe(400);
    });

    it('re-pins to the bottom when a session is opened or a message is sent', async () => {
      setScrollport(host, { scrollHeight: 1000, clientHeight: 400 });
      await token();
      await readerScrollsTo(120);
      expect(component.pinnedToBottom()).toBe(false);

      component.openSession('s1');
      expect(component.pinnedToBottom()).toBe(true);

      component.startNewSession();
      expect(component.pinnedToBottom()).toBe(true);

      await readerScrollsTo(0);
      component.sendMessage({ text: 'hello' } as never);
      expect(component.pinnedToBottom()).toBe(true);
    });

    it('keeps the transcript keyboard-scrollable', () => {
      expect(host.getAttribute('tabindex')).toBe('0');
      expect(host.getAttribute('aria-label')).toBe('Conversation transcript');
    });
  });
});
