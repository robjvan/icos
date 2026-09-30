import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { ChatUiComponent } from './chat-ui-component';
import { ConversationStore } from '../../services/conversation-store';

describe('ChatUiComponent', () => {
  let component: ChatUiComponent;
  let fixture: ComponentFixture<ChatUiComponent>;

  beforeEach(async () => {
    const store = {
      sessionId: () => null,
      messages: () => [],
      busy: () => false,
      sessions: () => [],
      searchResults: () => null,
      approvals: () => [],
      clarifications: () => [],
      pendingText: () => null,
      pendingTyping: () => false,
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
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the shell regions', () => {
    fixture.detectChanges();
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
});
