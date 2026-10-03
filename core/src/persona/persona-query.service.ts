import { Injectable } from '@nestjs/common';
import { PersonaRepository } from './persona.repository';
import {
  DEFAULT_PERSONA_USER_ID,
  type PersonaCandidate,
  type PersonaDriftEntry,
  type PersonaRecord,
  type PersonaRelationship,
  type PersonaUserFact,
} from './persona.types';

export interface PersonaOverview {
  records: PersonaRecord[];
  userFacts: PersonaUserFact[];
  relationship: PersonaRelationship | null;
}

/** Read-only projections of the persona stores, for inspection (M14g). */
@Injectable()
export class PersonaQueryService {
  constructor(private readonly repository: PersonaRepository) {}

  async pending(): Promise<PersonaCandidate[]> {
    return this.repository.listPendingCandidates(DEFAULT_PERSONA_USER_ID);
  }

  async overview(): Promise<PersonaOverview> {
    const [records, userFacts, relationship] = await Promise.all([
      this.repository.listRecords(DEFAULT_PERSONA_USER_ID, 200),
      this.repository.listUserFacts(DEFAULT_PERSONA_USER_ID, 200),
      this.repository.getRelationship(DEFAULT_PERSONA_USER_ID),
    ]);
    return { records, userFacts, relationship };
  }

  async drift(limit = 100): Promise<PersonaDriftEntry[]> {
    return this.repository.listRecentDrift(DEFAULT_PERSONA_USER_ID, limit);
  }
}
