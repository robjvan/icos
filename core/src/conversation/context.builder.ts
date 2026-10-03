import type { ChatMessage } from '../llm/llm.client';
import type { LoadedSkill, SkillScope } from '../skills/skill.types';

export interface ContextSkills {
  /** Prebuilt catalog block (names + descriptions); empty when disabled. */
  catalog: string;
  /** Session-pinned bodies, injected first. */
  explicit: LoadedSkill[];
  /** Staged one-shot bodies, injected second. */
  requested: LoadedSkill[];
  /** Auto-discovered bodies in selector rank order, injected third. */
  contextual: LoadedSkill[];
}

/**
 * Smallest useful representation of the current situation (core.md:
 * "Context is constructed, not accumulated"). Milestone 1 inputs are
 * system prompt + bounded history + current user message only.
 * Memory recall, tasks, observations, and tool state join here later.
 *
 * Skills (M7c) enter as system-scope, delimited, verbatim prompt data —
 * session-pinned first (alphabetical), then requested one-shots
 * (alphabetical), then contextual discoveries (selector rank order).
 * Skill names match ^[a-z0-9-]+$, so the delimiter attribute cannot break
 * out. Omitting `skills` yields byte-identical pre-M7 context.
 *
 * Recalled memory (M11d) enters as labeled system-scope bands after
 * the system head and before history: the memory band (beliefs with
 * origin + confidence, never user speech) then the KB band when the
 * bridge returned hits. Omitting `memory` yields byte-identical pre-M11
 * context. Bands never reach the transcript — only these assembled
 * messages — so extraction cannot mine them as user-said (M11d
 * anti-laundering rule).
 */
export interface ContextMemory {
  /**
   * Source/situation band (M16): where this turn arrived from (e.g. a
   * Discord DM or channel). Its own system block, ahead of persona and
   * memory. Optional/absent yields byte-identical context for non-channel
   * turns.
   */
  sourceBand?: string | null;
  /**
   * Persona grounding band (M14d): immutable core first, then evolving
   * identity/user context, as its own provenance-tagged system block —
   * never mixed with the memory bands. Optional/absent yields
   * byte-identical pre-M14 context.
   */
  personaBand?: string | null;
  /** Labeled belief lines, or null when recall found nothing to say. */
  memoryBand: string | null;
  /** Labeled corpus slot (absence declared, never silent). */
  kbBand: string | null;
}

export function buildContext(
  systemPrompt: string,
  history: ChatMessage[],
  input: string,
  maxHistory: number,
  skills?: ContextSkills,
  memory?: ContextMemory,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const prompt = systemPrompt.trim();
  const catalog = skills?.catalog.trim() ?? '';
  const system = [prompt, catalog].filter((part) => part !== '').join('\n\n');
  if (system) {
    messages.push({ role: 'system', content: system });
  }
  const scoped: Array<{ skill: LoadedSkill; scope: SkillScope }> = [
    ...[...(skills?.explicit ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((skill) => ({ skill, scope: 'explicit' as const })),
    ...[...(skills?.requested ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((skill) => ({ skill, scope: 'turn-explicit' as const })),
    ...(skills?.contextual ?? []).map((skill) => ({
      skill,
      scope: 'contextual' as const,
    })),
  ];
  for (const { skill, scope } of scoped) {
    messages.push({
      role: 'system',
      content: `<skill name="${skill.name}" scope="${scope}">\n${skill.body}\n</skill>`,
    });
  }
  if (memory?.sourceBand) {
    messages.push({ role: 'system', content: memory.sourceBand });
  }
  if (memory?.personaBand) {
    messages.push({ role: 'system', content: memory.personaBand });
  }
  if (memory?.memoryBand) {
    messages.push({ role: 'system', content: memory.memoryBand });
  }
  if (memory?.kbBand) {
    messages.push({ role: 'system', content: memory.kbBand });
  }
  messages.push(...history.slice(-maxHistory));
  messages.push({ role: 'user', content: input });
  return messages;
}
