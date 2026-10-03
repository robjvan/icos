import { Injectable, inject, signal } from '@angular/core';
import { PERSONA_ENDPOINT } from '../../constants';
import type {
  PersonaCandidate,
  PersonaCoreView,
  PersonaDriftEntry,
  PersonaOverview,
  PersonaRecord,
  PersonaRelationship,
  PersonaReviewOutcome,
  PersonaReviewResult,
  PersonaUserFact,
} from '../models/persona';
import { CoreApiService } from './core-api.service';

/**
 * Persona review (M14g). Owns the read projections of the persona stores
 * plus the review mutation. The immutable core is read-only here — there
 * is deliberately no client path that edits it.
 */
@Injectable({ providedIn: 'root' })
export class PersonaService {
  private readonly api = inject(CoreApiService);

  readonly core = signal<PersonaCoreView | null>(null);
  readonly records = signal<readonly PersonaRecord[]>([]);
  readonly userFacts = signal<readonly PersonaUserFact[]>([]);
  readonly relationship = signal<PersonaRelationship | null>(null);
  readonly candidates = signal<readonly PersonaCandidate[]>([]);
  readonly drift = signal<readonly PersonaDriftEntry[]>([]);
  readonly loading = signal(false);
  readonly busyId = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [core, overview, candidates, drift] = await Promise.all([
        this.api.get<PersonaCoreView>(`${PERSONA_ENDPOINT}/core`),
        this.api.get<PersonaOverview>(`${PERSONA_ENDPOINT}/records`),
        this.api.get<{ candidates: PersonaCandidate[] }>(
          `${PERSONA_ENDPOINT}/candidates`,
        ),
        this.api.get<{ drift: PersonaDriftEntry[] }>(`${PERSONA_ENDPOINT}/drift`),
      ]);
      this.core.set(core);
      this.records.set(overview.records);
      this.userFacts.set(overview.userFacts);
      this.relationship.set(overview.relationship);
      this.candidates.set(candidates.candidates);
      this.drift.set(drift.drift);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.loading.set(false);
    }
  }

  /** Apply a review outcome, then re-fetch. A refusal is a normal result. */
  async review(
    candidateId: string,
    input: { outcome: PersonaReviewOutcome; reason: string; reviewedBy: string },
  ): Promise<PersonaReviewResult | null> {
    if (this.busyId() !== null) {
      return null;
    }
    this.busyId.set(candidateId);
    this.error.set(null);
    try {
      return await this.api.post<PersonaReviewResult>(
        `${PERSONA_ENDPOINT}/candidates/${candidateId}/review`,
        input,
      );
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      this.busyId.set(null);
      await this.refresh();
    }
  }
}
