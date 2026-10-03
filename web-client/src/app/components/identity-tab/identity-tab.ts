import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import type {
  PersonaCandidate,
  PersonaProposedTarget,
  PersonaReviewOutcome,
} from '../../models/persona';
import { PersonaService } from '../../services/persona.service';

/**
 * Identity / persona review (M14g). Shows the immutable core
 * (read-only, with its recorded hash), the evolving tier, the pending
 * candidate queue with provenance, and the drift/audit history — so one
 * screen answers "why does ICOS believe this, and when did it change?".
 */
@Component({
  selector: 'app-identity-tab',
  templateUrl: './identity-tab.html',
  styleUrl: './identity-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IdentityTab implements OnInit {
  readonly persona = inject(PersonaService);

  readonly reviewer = signal('');
  readonly reasons = signal<Record<string, string>>({});
  readonly approveTargets = signal<Record<string, PersonaProposedTarget>>({});
  readonly lastResult = signal<string | null>(null);

  readonly hasReviewer = computed(() => this.reviewer().trim().length > 0);

  ngOnInit(): void {
    void this.persona.refresh();
  }

  setReviewer(value: string): void {
    this.reviewer.set(value);
  }

  reasonFor(candidateId: string): string {
    return this.reasons()[candidateId] ?? '';
  }

  setReason(candidateId: string, value: string): void {
    this.reasons.update((map) => ({ ...map, [candidateId]: value }));
  }

  targetFor(candidate: PersonaCandidate): PersonaProposedTarget {
    return (
      this.approveTargets()[candidate.candidateId] ??
      candidate.proposedTarget ??
      'persona_record'
    );
  }

  setTarget(candidateId: string, value: string): void {
    this.approveTargets.update((map) => ({
      ...map,
      [candidateId]: value as PersonaProposedTarget,
    }));
  }

  canAct(candidateId: string): boolean {
    return (
      this.hasReviewer() &&
      this.reasonFor(candidateId).trim().length > 0 &&
      this.persona.busyId() === null
    );
  }

  outcomeForTarget(target: PersonaProposedTarget): PersonaReviewOutcome {
    if (target === 'persona_user_model') {
      return 'approve_to_user_model';
    }
    if (target === 'persona_relationship') {
      return 'approve_to_relationship';
    }
    return 'approve_to_identity';
  }

  approve(candidate: PersonaCandidate): Promise<void> {
    return this.review(candidate, this.outcomeForTarget(this.targetFor(candidate)));
  }

  reject(candidate: PersonaCandidate): Promise<void> {
    return this.review(candidate, 'reject');
  }

  archive(candidate: PersonaCandidate): Promise<void> {
    return this.review(candidate, 'archive_as_transient');
  }

  needsEvidence(candidate: PersonaCandidate): Promise<void> {
    return this.review(candidate, 'needs_more_evidence');
  }

  shortHash(hash: string | null): string {
    return hash ? `${hash.slice(0, 12)}…` : '—';
  }

  confidence(value: number): string {
    return value.toFixed(2);
  }

  private async review(
    candidate: PersonaCandidate,
    outcome: PersonaReviewOutcome,
  ): Promise<void> {
    if (!this.canAct(candidate.candidateId)) {
      return;
    }
    const result = await this.persona.review(candidate.candidateId, {
      outcome,
      reason: this.reasonFor(candidate.candidateId),
      reviewedBy: this.reviewer().trim(),
    });
    if (result) {
      this.lastResult.set(
        result.refused
          ? `Refused — ${result.refusalReason ?? 'contradicts the core'}`
          : `${outcome} applied`,
      );
      this.reasons.update((map) => {
        const next = { ...map };
        delete next[candidate.candidateId];
        return next;
      });
    }
  }
}
