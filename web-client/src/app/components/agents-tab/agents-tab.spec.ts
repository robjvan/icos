import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { signal } from '@angular/core';

import { AgentsTab } from './agents-tab';
import { DelegationService } from '../../services/delegation.service';
import { ConversationStore } from '../../services/conversation-store';
import type { Delegation } from '../../models/delegation';

const DELEGATIONS: Delegation[] = [
  {
    id: 'task-1',
    parentSessionId: 'parent-1',
    childSessionId: 'child-1',
    parentRunId: null,
    goal: 'research widgets',
    state: 'completed',
    resultSummary: 'found three suppliers',
    error: null,
    cancelRequested: false,
    budgets: { maxIterations: 5, maxToolSteps: 5, maxTurnDurationMs: 300000 },
    createdAt: 't',
    updatedAt: 't',
  },
  {
    id: 'task-2',
    parentSessionId: 'parent-1',
    childSessionId: 'child-2',
    parentRunId: null,
    goal: 'draft release notes',
    state: 'running',
    resultSummary: null,
    error: null,
    cancelRequested: false,
    budgets: { maxIterations: 5, maxToolSteps: 5, maxTurnDurationMs: 300000 },
    createdAt: 't',
    updatedAt: 't',
  },
];

describe('AgentsTab', () => {
  let fixture: ComponentFixture<AgentsTab>;

  const delegationsApi = {
    list: vi.fn(() => Promise.resolve({ delegations: DELEGATIONS })),
  };
  const conversation = { sessionId: signal<string | null>('parent-1') };

  beforeEach(async () => {
    delegationsApi.list.mockClear();
    await TestBed.configureTestingModule({
      imports: [AgentsTab],
      providers: [
        { provide: DelegationService, useValue: delegationsApi },
        { provide: ConversationStore, useValue: conversation },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentsTab);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('lists the active session delegations with states', async () => {
    await fixture.componentInstance.refresh();
    fixture.detectChanges();
    expect(delegationsApi.list).toHaveBeenCalledWith('parent-1');
    const compiled = fixture.nativeElement as HTMLElement;
    const text = compiled.textContent ?? '';
    expect(text).toContain('research widgets');
    expect(text).toContain('completed');
    expect(text).toContain('found three suppliers');
    expect(text).toContain('draft release notes');
    expect(text).toContain('1 active');
  });

  it('shows an empty state with no active session', async () => {
    conversation.sessionId.set(null);
    await fixture.componentInstance.refresh();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('No delegated subagent tasks');
    conversation.sessionId.set('parent-1');
  });
});
