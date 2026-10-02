import { createId } from './persona-ids';
import {
  hasTemplatePlaceholder,
  splitMarkdownSections,
  statementsIn,
} from './persona-markdown';
import type { PersonaCoreCategory, PersonaCoreEntry } from './persona.types';

/**
 * Parser for the immutable core persona file (M14b).
 *
 * The core is a human-authored Markdown file. Section headings map to
 * the five core categories; bullets and paragraphs become entries. The
 * parse is pure and deterministic — the same file always yields the same
 * entries and ids — so a boot can hash and compare without surprises.
 *
 * This module only *reads* text. There is no write path anywhere in the
 * core subsystem; the strongest deployment additionally bind-mounts the
 * core directory read-only.
 */

export const PERSONA_CORE_CATEGORIES: readonly PersonaCoreCategory[] = [
  'ethical_grounding',
  'core_belief',
  'safety_boundary',
  'non_negotiable',
  'agentic_character',
];

export interface ParsedPersonaCore {
  entries: PersonaCoreEntry[];
  warnings: string[];
}

/** Map a section heading to a core category, or null when unrecognized. */
export function coreCategoryForHeading(
  heading: string,
): PersonaCoreCategory | null {
  const text = heading.toLowerCase();
  if (/non[\s-]?negotiable|never|must not|inviolable|immutable/.test(text)) {
    return 'non_negotiable';
  }
  if (/ethic|integrity|honesty|truth|deception/.test(text)) {
    return 'ethical_grounding';
  }
  if (/safet|boundar|harm|danger/.test(text)) {
    return 'safety_boundary';
  }
  if (/character|agentic|demeanor|temperament|disposition/.test(text)) {
    return 'agentic_character';
  }
  if (/belief|principle|conviction|values?/.test(text)) {
    return 'core_belief';
  }
  return null;
}

/**
 * Parse a core persona file. Ids are content-addressed (category +
 * statement), so reordering sections does not change them.
 */
export function parsePersonaCore(
  markdown: string,
  sourcePath: string,
): ParsedPersonaCore {
  const warnings: string[] = [];
  const entries: PersonaCoreEntry[] = [];

  for (const section of splitMarkdownSections(markdown)) {
    const category = coreCategoryForHeading(section.heading);
    if (!category) {
      continue;
    }
    const statements = statementsIn(section.body);
    if (statements.length === 0) {
      warnings.push(`Core section "${section.heading}" had no entries.`);
      continue;
    }
    for (const statement of statements) {
      if (hasTemplatePlaceholder(statement)) {
        warnings.push(
          `Skipped a template placeholder under "${section.heading}".`,
        );
        continue;
      }
      entries.push({
        entryId: createId(
          'persona-core',
          `${sourcePath}:${category}:${statement}`,
        ),
        category,
        content: statement,
        immutable: true,
      });
    }
  }

  return { entries, warnings };
}
