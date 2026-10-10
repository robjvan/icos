import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { ContextPanel } from './context-panel';
import { ContextService } from '../../services/context.service';
import { ConversationStore } from '../../services/conversation-store';
import type { ContextSettings, ContextSummary } from '../../models/context';

const SETTINGS: ContextSettings = {
  contextWindow: 1_000_000,
  maxOutputTokens: 8192,
  usableTokens: 991_808,
  triggerTokens: 793_446,
  target: 0.8,
  enabled: true,
};

const SUMMARY: ContextSummary = {
  sessionId: 's1',
  summary: 'Earlier turns: the user chose a 1M-token model.',
  coveredUptoMessageId: 12,
  tokenEstimate: 20,
  createdAt: 't0',
  updatedAt: 't1',
};

describe('ContextPanel', () => {
  const contextApi = {
    settings: vi.fn(() => Promise.resolve(SETTINGS)),
    summary: vi.fn(() =>
      Promise.resolve({ sessionId: 's1', summary: SUMMARY, settings: SETTINGS }),
    ),
  };
  const conversation = { sessionId: signal<string | null>('s1') };

  let fixture: ComponentFixture<ContextPanel>;

  beforeEach(async () => {
    contextApi.settings.mockClear();
    contextApi.summary.mockClear();
    await TestBed.configureTestingModule({
      imports: [ContextPanel],
      providers: [
        { provide: ContextService, useValue: contextApi },
        { provide: ConversationStore, useValue: conversation },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ContextPanel);
    fixture.detectChanges();
    await fixture.componentInstance.refresh();
    fixture.detectChanges();
  });

  it('shows the budget read-out and the rolling summary', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('1,000,000');
    expect(text).toContain('793,446');
    expect(text).toContain('#12');
    expect(text).toContain('1M-token model');
    expect(contextApi.summary).toHaveBeenCalledWith('s1');
  });
});
