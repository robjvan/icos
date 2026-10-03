import { slug, splitMarkdownSections, statementsIn } from './persona-markdown';
import type {
  PersonaCategory,
  PersonaSensitivity,
  PersonaSeedSourceKind,
} from './persona.types';

/**
 * Parser for persona seed Markdown (M14c).
 *
 * A seed is a human-authored file that bootstraps the **evolving** tier
 * (never the immutable core). Section headings select a category, a
 * sensitivity, and whether the imported record is `protected`
 * (review-required to overwrite). This is a guarded port of the v2
 * coherence-engine seed importer; the produced candidates still go
 * through the same idempotent, conflict-staging path as any other write.
 */

export interface PersonaSeedCandidate {
  /** Stable within a source file: `ordinal:slug:index`. */
  key: string;
  category: PersonaCategory;
  sensitivity: PersonaSensitivity;
  protected: boolean;
  layer: string;
  content: string;
}

export interface PersonaSeedSectionPolicy {
  category: PersonaCategory;
  sensitivity: PersonaSensitivity;
  protected: boolean;
  layer: string;
}

/**
 * Map a seed section heading to a persona policy, or null to skip the
 * section. Ported from the v2 seed importer, retargeted at ICOS
 * persona categories.
 */
export function seedSectionPolicy(
  heading: string,
  kind: PersonaSeedSourceKind,
): PersonaSeedSectionPolicy | null {
  const text = heading.toLowerCase();
  if (
    /core values?|honesty|pushback|transparency|respect for time|grace/.test(
      text,
    )
  ) {
    return {
      category: 'value',
      sensitivity: 'sensitive',
      protected: true,
      layer: 'agentic_character',
    };
  }
  if (/boundar/.test(text)) {
    return {
      category: 'boundary',
      sensitivity: 'protected',
      protected: true,
      layer: 'soul_seed',
    };
  }
  if (/direction|commitment/.test(text)) {
    return {
      category: 'commitment',
      sensitivity: 'normal',
      protected: false,
      layer: 'soul_seed',
    };
  }
  if (/growth process|quirks|habits|scenarios? in action/.test(text)) {
    return {
      category: 'agentic_character',
      sensitivity: 'sensitive',
      protected: true,
      layer: 'growth_process',
    };
  }
  if (/relationship|team|why .* keeps/.test(text)) {
    return {
      category: 'relationship',
      sensitivity: 'sensitive',
      protected: false,
      layer: 'team_context',
    };
  }
  if (/current self|vital statistics|profile/.test(text)) {
    return {
      category: 'self',
      sensitivity: 'sensitive',
      protected: false,
      layer: kind === 'soul' ? 'soul_seed' : 'persona',
    };
  }
  if (kind === 'persona' && !/signature moments?/.test(text)) {
    return {
      category: 'self',
      sensitivity: 'sensitive',
      protected: false,
      layer: 'persona',
    };
  }
  return null;
}

/** Parse a seed document into candidate records. */
export function parsePersonaSeed(
  markdown: string,
  kind: PersonaSeedSourceKind,
): PersonaSeedCandidate[] {
  const candidates: PersonaSeedCandidate[] = [];
  for (const section of splitMarkdownSections(markdown)) {
    const policy = seedSectionPolicy(section.heading, kind);
    if (!policy) {
      continue;
    }
    statementsIn(section.body).forEach((content, index) => {
      candidates.push({
        key: `${section.ordinal}:${slug(section.heading)}:${index}`,
        category: policy.category,
        sensitivity: policy.sensitivity,
        protected: policy.protected,
        layer: policy.layer,
        content,
      });
    });
  }
  return candidates;
}
