import type { ToolDescriptor } from './tool-registry';
import { tokenizeInput } from '../skills/skill-discovery';

/**
 * Deterministic tool discovery (M20.7.1). Matches caller input against tool
 * names, toolsets, and descriptions only — no embeddings, no vectors, no LLM.
 *
 * Pure function: descriptors + input ⇒ ranked matches. Never executes, never
 * mutates, never widens authorization — it only *ranks* descriptors already
 * enabled by the operator policy. Same input + same catalog ⇒ byte-identical
 * output.
 *
 * Scoring (documented, deliberately simple — mirrors `skill-discovery`):
 * - each distinct input token scoring a name-substring hit: +2 (matchedOn name)
 * - else each distinct token scoring a toolset-substring hit: +2 (matchedOn
 *   toolset — `files`, `mcp-github`, …)
 * - else each distinct token scoring a description-substring hit: +1
 * - tokens shorter than MIN_TOKEN_CHARS are ignored (single letters would
 *   match nearly every description and drown the ranking)
 * - rank: score desc, then name asc. Zero-score tools never match.
 */
export const TOOL_DISCOVERY_DEFAULT_LIMIT = 8;
const NAME_HIT_SCORE = 2;
const TOOLSET_HIT_SCORE = 2;
const DESCRIPTION_HIT_SCORE = 1;

export interface ToolMatch {
  tool: ToolDescriptor;
  score: number;
  matchedOn: Array<'name' | 'toolset' | 'description'>;
}

export function discoverTools(
  descriptors: readonly ToolDescriptor[],
  input: string,
  limit: number = TOOL_DISCOVERY_DEFAULT_LIMIT,
): ToolMatch[] {
  const tokens = tokenizeInput(input);
  if (tokens.length === 0 || limit <= 0) return [];
  const matches: ToolMatch[] = [];
  for (const tool of descriptors) {
    const name = tool.name.toLowerCase();
    const toolset = tool.toolset.toLowerCase();
    const description = tool.description.toLowerCase();
    let score = 0;
    const matchedOn = new Set<'name' | 'toolset' | 'description'>();
    for (const token of tokens) {
      if (name.includes(token)) {
        score += NAME_HIT_SCORE;
        matchedOn.add('name');
      } else if (toolset.includes(token)) {
        score += TOOLSET_HIT_SCORE;
        matchedOn.add('toolset');
      } else if (description.includes(token)) {
        score += DESCRIPTION_HIT_SCORE;
        matchedOn.add('description');
      }
    }
    if (score > 0) {
      matches.push({ tool, score, matchedOn: [...matchedOn] });
    }
  }
  matches.sort(
    (a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name),
  );
  return matches.slice(0, limit);
}
