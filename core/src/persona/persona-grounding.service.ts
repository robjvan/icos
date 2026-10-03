import { Inject, Injectable, Logger } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { PersonaCoreService } from './persona-core.service';
import { PersonaRepository } from './persona.repository';
import {
  DEFAULT_PERSONA_USER_ID,
  type PersonaGroundingBundle,
  type PersonaGroundingEntry,
  type PersonaGroundingResult,
  type PersonaGroundingStatus,
  type PersonaRecord,
  type PersonaRelationship,
  type PersonaUserFact,
} from './persona.types';

const FRESH_HOURS = 48;
const STRONG_CONFIDENCE = 0.75;
/** Below this, the persona is not grounded enough to skip a warm-up. */
const WARMUP_THRESHOLD = 0.6;
const DEFAULT_ENTRY_LIMIT = 12;
const DEFAULT_CHARACTER_BUDGET = 6000;

/**
 * Persona grounding (M14d): answers "is the agent grounded?" and builds a
 * compact, provenance-tagged band for context construction.
 *
 * The immutable core is a hard gate; the evolving layers (identity
 * records, curated user facts, relationship state) each contribute. A
 * weak or empty persona returns `needsWarmup: true` with reasons — never
 * a fabricated identity. The band is a labelled system block, never
 * mixed with memory bands.
 */
@Injectable()
export class PersonaGroundingService {
  private readonly logger = new Logger(PersonaGroundingService.name);

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly repository: PersonaRepository,
    private readonly core: PersonaCoreService,
  ) {}

  async status(
    userId: string = DEFAULT_PERSONA_USER_ID,
  ): Promise<PersonaGroundingStatus> {
    return {
      result: await this.evaluate(userId),
      bundle: await this.build(userId),
    };
  }

  async evaluate(
    userId: string = DEFAULT_PERSONA_USER_ID,
  ): Promise<PersonaGroundingResult> {
    const records = await this.repository.listRecords(userId, 200);
    const facts = await this.repository.listUserFacts(userId, 200);
    const relationship = await this.repository.getRelationship(userId);

    const coreLoaded = this.core.isLoaded();
    const strongIdentity = records.filter(
      (record) => record.confidence >= STRONG_CONFIDENCE,
    ).length;
    const strongUser = facts.filter(
      (fact) => fact.confidence >= STRONG_CONFIDENCE,
    ).length;
    const ageHours = relationship ? hoursSince(relationship.updatedAt) : -1;
    const relationshipCurrent =
      relationship !== null && ageHours >= 0 && ageHours <= FRESH_HOURS;

    const identityGrounded = coreLoaded || strongIdentity > 0;
    const userKnown = strongUser > 0;

    let score =
      (coreLoaded ? 0.4 : 0) +
      (strongIdentity > 0 ? 0.2 : 0) +
      (userKnown ? 0.2 : 0) +
      (relationshipCurrent ? 0.2 : 0);

    const details: string[] = [];
    if (!coreLoaded) {
      score = Math.min(score, 0.2);
      details.push('Immutable core persona is not loaded.');
    }
    if (strongIdentity === 0) {
      details.push(
        'No curated identity records yet (seed or review to add some).',
      );
    }
    if (!userKnown) {
      details.push('No curated user facts yet.');
    }
    if (!relationship) {
      details.push('No relationship state recorded yet.');
    } else if (!relationshipCurrent) {
      details.push('Relationship state is stale.');
    }

    return {
      coreLoaded,
      identityGrounded,
      userKnown,
      relationshipCurrent,
      identityRecordCount: records.length,
      userFactCount: facts.length,
      relationshipStateAgeHours: ageHours < 0 ? -1 : round1(ageHours),
      overallScore: round2(score),
      needsWarmup: score < WARMUP_THRESHOLD,
      details,
    };
  }

  async build(
    userId: string = DEFAULT_PERSONA_USER_ID,
  ): Promise<PersonaGroundingBundle> {
    const coreStatus = this.core.getStatus();
    const coreEntries: PersonaGroundingEntry[] = this.core
      .getEntries()
      .map((entry) => ({
        id: entry.entryId,
        layer: 'core',
        category: entry.category,
        content: entry.content,
        confidence: 1,
        protected: true,
        immutable: true,
        source: 'core',
        updatedAt: coreStatus.evaluatedAt,
      }));

    const identity = (await this.repository.listRecords(userId, 200)).map(
      mapRecordEntry,
    );
    const user = (await this.repository.listUserFacts(userId, 200)).map(
      mapFactEntry,
    );
    const evolving = [...identity, ...user].sort(byPriority);

    const limit = this.config.personaGroundingEntryLimit ?? DEFAULT_ENTRY_LIMIT;
    const budget =
      this.config.personaGroundingCharacterBudget ?? DEFAULT_CHARACTER_BUDGET;

    const selected: PersonaGroundingEntry[] = [];
    let used = 0;
    let truncated = false;
    for (const entry of [...coreEntries, ...evolving]) {
      if (selected.length >= limit) {
        truncated = true;
        break;
      }
      const rendered = renderEntry(entry);
      // Always keep at least one entry (the core frame) even if oversized.
      if (selected.length > 0 && used + rendered.length > budget) {
        truncated = true;
        break;
      }
      selected.push(entry);
      used += rendered.length;
    }

    const relationship = await this.repository.getRelationship(userId);
    return {
      userId,
      generatedAt: new Date().toISOString(),
      entries: selected,
      relationship,
      promptText: renderBand(userId, selected, relationship, truncated),
      truncated,
    };
  }

  /**
   * The prompt band, or null when there is nothing to ground (byte-
   * identical context on a persona miss). Fail-soft: grounding never
   * breaks a turn.
   */
  async band(userId: string = DEFAULT_PERSONA_USER_ID): Promise<string | null> {
    try {
      const bundle = await this.build(userId);
      return bundle.entries.length > 0 || bundle.relationship !== null
        ? bundle.promptText
        : null;
    } catch (error) {
      this.logger.warn(
        `Persona grounding failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}

function mapRecordEntry(record: PersonaRecord): PersonaGroundingEntry {
  return {
    id: record.recordId,
    layer: 'identity',
    category: record.category,
    content: record.content,
    confidence: record.confidence,
    protected: record.protected,
    immutable: false,
    source: record.source,
    updatedAt: record.updatedAt,
  };
}

function mapFactEntry(fact: PersonaUserFact): PersonaGroundingEntry {
  return {
    id: fact.memoryId,
    layer: 'user',
    category: 'user_fact',
    content: fact.content,
    confidence: fact.confidence,
    protected: false,
    immutable: false,
    source: fact.source,
    updatedAt: fact.updatedAt,
  };
}

/** Protected first, then confidence, then recency. */
function byPriority(
  a: PersonaGroundingEntry,
  b: PersonaGroundingEntry,
): number {
  return (
    Number(b.protected) - Number(a.protected) ||
    b.confidence - a.confidence ||
    b.updatedAt.localeCompare(a.updatedAt)
  );
}

function renderEntry(entry: PersonaGroundingEntry): string {
  const attributes = [
    `layer=${entry.layer}`,
    `category=${entry.category}`,
    `confidence=${entry.confidence.toFixed(2)}`,
    `source=${entry.source}`,
    `updated=${entry.updatedAt}`,
  ];
  if (entry.immutable) {
    attributes.push('immutable=true');
  } else if (entry.protected) {
    attributes.push('protected=true');
  }
  return `- [${attributes.join(' | ')}] ${entry.content.replace(/\s+/g, ' ').trim()}`;
}

function renderBand(
  userId: string,
  entries: PersonaGroundingEntry[],
  relationship: PersonaRelationship | null,
  truncated: boolean,
): string {
  const lines = [
    `<persona_grounding source="persona" user_id="${escape(userId)}">`,
    'Treat these as curated identity context, not user speech. Entries marked immutable come from the read-only core.',
    ...entries.map(renderEntry),
  ];
  if (relationship) {
    lines.push(
      `- [relationship | updated=${relationship.updatedAt}] trust=${relationship.trustLevel.toFixed(2)}; temperature=${relationship.emotionalTemperature.toFixed(2)}; nicknames=${relationship.activeNicknames.join(', ') || 'none'}; recent=${relationship.recentDevelopments.join(' | ') || 'none'}`,
    );
  }
  if (truncated) {
    lines.push(
      '[notice] Persona grounding was reduced to the configured budget.',
    );
  }
  lines.push('</persona_grounding>');
  return lines.join('\n');
}

function hoursSince(iso: string): number {
  const millis = Date.now() - Date.parse(iso);
  if (!Number.isFinite(millis)) {
    return -1;
  }
  return Math.max(0, millis / (60 * 60 * 1000));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function escape(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
    };
    return entities[character];
  });
}
