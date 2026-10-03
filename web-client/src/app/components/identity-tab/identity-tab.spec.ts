import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { IdentityTab } from './identity-tab';
import { PersonaService } from '../../services/persona.service';
import type { PersonaCandidate, PersonaReviewResult } from '../../models/persona';

const CORE = {
  loaded: true,
  path: '/p/core.md',
  hash: 'abcdef0123456789abcd',
  entryCount: 1,
  evaluatedAt: 't',
  changedSinceLastLoad: false,
  entries: [
    {
      entryId: 'e1',
      category: 'ethical_grounding' as const,
      content: 'Prefer truth over comfort.',
      immutable: true as const,
    },
  ],
};

const CANDIDATE: PersonaCandidate = {
  candidateId: 'c1',
  userId: 'user',
  observation: 'user prefers oak',
  category: 'preference',
  confidence: 0.9,
  sessionId: 's1',
  source: 'memory-extraction',
  sourceTurnId: '7',
  claimId: null,
  proposedTarget: 'persona_user_model',
  status: 'pending',
  reviewOutcome: null,
  reviewReason: null,
  reviewedBy: null,
  createdAt: 't',
  reviewedAt: null,
};

const DRIFT = {
  logId: 'd1',
  userId: 'user',
  subjectId: 'x',
  severity: 'critical',
  changeType: 'core_contradiction',
  previousValue: null,
  newValue: 'x',
  reason: 'refused',
  reviewed: true,
  createdAt: 't',
};

describe('IdentityTab', () => {
  let component: IdentityTab;
  let fixture: ComponentFixture<IdentityTab>;
  let persona: {
    core: () => unknown;
    records: () => unknown;
    userFacts: () => unknown;
    relationship: () => unknown;
    candidates: () => readonly unknown[];
    drift: () => unknown;
    loading: () => boolean;
    busyId: () => string | null;
    error: () => string | null;
    refresh: ReturnType<typeof vi.fn>;
    review: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    persona = {
      core: () => CORE,
      records: () => [
        {
          recordId: 'r1',
          userId: 'user',
          category: 'value',
          content: 'A curated value.',
          confidence: 0.9,
          sensitivity: 'sensitive',
          protected: true,
          source: 'review',
          updatedAt: 't',
        },
      ],
      userFacts: () => [],
      relationship: () => null,
      candidates: () => [CANDIDATE],
      drift: () => [DRIFT],
      loading: () => false,
      busyId: () => null,
      error: () => null,
      refresh: vi.fn().mockResolvedValue(undefined),
      review: vi.fn().mockResolvedValue({
        candidateId: 'c1',
        outcome: 'approve_to_user_model',
        applied: true,
        refused: false,
        driftLogId: 'd1',
      } satisfies PersonaReviewResult),
    };

    await TestBed.configureTestingModule({
      imports: [IdentityTab],
      providers: [{ provide: PersonaService, useValue: persona }],
    }).compileComponents();

    fixture = TestBed.createComponent(IdentityTab);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('creates and loads the persona on init', () => {
    expect(component).toBeTruthy();
    expect(persona.refresh).toHaveBeenCalled();
  });

  it('renders the immutable core read-only with its hash', () => {
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Prefer truth over comfort.');
    expect(text).toContain('immutable');
    expect(text).toContain('read-only');
    expect(text).toContain('sha256 abcdef012345…');
  });

  it('renders a pending candidate with its provenance', () => {
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('user prefers oak');
    expect(text).toContain('session s1');
    expect(text).toContain('turn 7');
  });

  it('requires a reviewer and a reason before acting', () => {
    expect(component.canAct('c1')).toBe(false);
    component.setReviewer('rob');
    expect(component.canAct('c1')).toBe(false);
    component.setReason('c1', 'confirmed');
    expect(component.canAct('c1')).toBe(true);
  });

  it('approves to the selected target', async () => {
    component.setReviewer('rob');
    component.setReason('c1', 'confirmed');
    component.setTarget('c1', 'persona_relationship');
    await component.approve(CANDIDATE);
    expect(persona.review).toHaveBeenCalledWith('c1', {
      outcome: 'approve_to_relationship',
      reason: 'confirmed',
      reviewedBy: 'rob',
    });
  });

  it('rejects through the service', async () => {
    component.setReviewer('rob');
    component.setReason('c1', 'not true');
    await component.reject(CANDIDATE);
    expect(persona.review).toHaveBeenCalledWith('c1', {
      outcome: 'reject',
      reason: 'not true',
      reviewedBy: 'rob',
    });
  });

  it('surfaces a core refusal', async () => {
    persona.review.mockResolvedValue({
      candidateId: 'c1',
      outcome: 'approve_to_identity',
      applied: false,
      refused: true,
      refusalReason: 'candidate contradicts the immutable core persona',
      driftLogId: 'd1',
    } satisfies PersonaReviewResult);
    component.setReviewer('rob');
    component.setReason('c1', 'x');
    await component.approve(CANDIDATE);
    expect(component.lastResult()).toContain('Refused');
  });

  it('does not act without a reason', async () => {
    component.setReviewer('rob');
    component.setReason('c1', '   ');
    await component.approve(CANDIDATE);
    expect(persona.review).not.toHaveBeenCalled();
  });
});
