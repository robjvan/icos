import { buildContext } from './context.builder';
import type { ContextSkills } from './context.builder';
import { ChatMessage } from '../llm/llm.client';
import type { LoadedSkill } from '../skills/skill.types';

function loaded(name: string, body: string): LoadedSkill {
  return {
    name,
    description: `${name} desc`,
    version: '0.0.0',
    body,
    bodyChars: body.length,
  };
}

function skillsTier(overrides: Partial<ContextSkills> = {}): ContextSkills {
  return {
    catalog: '',
    explicit: [],
    requested: [],
    contextual: [],
    ...overrides,
  };
}

describe('buildContext', () => {
  it('assembles system prompt + history + input in order', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ];
    expect(buildContext('sys', history, 'c', 50)).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ]);
  });

  it('omits the system message when the prompt is blank', () => {
    expect(buildContext('  ', [], 'hi', 50)).toEqual([
      { role: 'user', content: 'hi' },
    ]);
  });

  it('bounds history to maxHistory', () => {
    const history: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: 'user' as const,
      content: `m${i}`,
    }));
    const result = buildContext('sys', history, 'new', 4);
    expect(result.map((m) => m.content)).toEqual([
      'sys',
      'm6',
      'm7',
      'm8',
      'm9',
      'new',
    ]);
  });

  it('appends the skill catalog block to the system prompt', () => {
    const result = buildContext(
      'sys',
      [],
      'hi',
      50,
      skillsTier({
        catalog: '<available_skills>\n- a: A.\n</available_skills>',
      }),
    );
    expect(result[0]).toEqual({
      role: 'system',
      content: 'sys\n\n<available_skills>\n- a: A.\n</available_skills>',
    });
  });

  it('injects explicit, requested, then contextual bodies as delimited system messages', () => {
    const result = buildContext(
      'sys',
      [{ role: 'user', content: 'old' }],
      'new',
      50,
      skillsTier({
        explicit: [loaded('b-skill', 'B body.')],
        requested: [loaded('a-skill', 'A body.')],
        contextual: [loaded('c-skill', 'C body.')],
      }),
    );
    expect(result.map((m) => m.content)).toEqual([
      'sys',
      '<skill name="b-skill" scope="explicit">\nB body.\n</skill>',
      '<skill name="a-skill" scope="turn-explicit">\nA body.\n</skill>',
      '<skill name="c-skill" scope="contextual">\nC body.\n</skill>',
      'old',
      'new',
    ]);
    expect(result.slice(1, 4).every((m) => m.role === 'system')).toBe(true);
  });

  it('orders multiple explicit skills alphabetically', () => {
    const result = buildContext(
      'sys',
      [],
      'hi',
      50,
      skillsTier({
        explicit: [loaded('zebra', 'Z.'), loaded('alpha', 'A.')],
      }),
    );
    expect(result.map((m) => m.content)).toEqual([
      'sys',
      '<skill name="alpha" scope="explicit">\nA.\n</skill>',
      '<skill name="zebra" scope="explicit">\nZ.\n</skill>',
      'hi',
    ]);
  });

  it('inserts memory bands after the system head, before history', () => {
    const history: ChatMessage[] = [{ role: 'user', content: 'a' }];
    const result = buildContext('sys', history, 'c', 50, undefined, {
      memoryBand: '[memory: 1 recalled]',
      kbBand: '[knowledge-base: connected]',
    });
    expect(result).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'system', content: '[memory: 1 recalled]' },
      { role: 'system', content: '[knowledge-base: connected]' },
      { role: 'user', content: 'a' },
      { role: 'user', content: 'c' },
    ]);
  });

  it('inserts the persona band before the memory band', () => {
    const history: ChatMessage[] = [{ role: 'user', content: 'a' }];
    const result = buildContext('sys', history, 'c', 50, undefined, {
      personaBand: '<persona_grounding></persona_grounding>',
      memoryBand: '[memory: 1 recalled]',
      kbBand: null,
    });
    expect(result.map((m) => m.content)).toEqual([
      'sys',
      '<persona_grounding></persona_grounding>',
      '[memory: 1 recalled]',
      'a',
      'c',
    ]);
  });

  it('omits null bands for byte-identical pre-M11 context', () => {
    const history: ChatMessage[] = [{ role: 'user', content: 'a' }];
    expect(
      buildContext('sys', history, 'c', 50, undefined, {
        memoryBand: null,
        kbBand: null,
      }),
    ).toEqual(buildContext('sys', history, 'c', 50));
  });

  it('inserts source and attachment bands ahead of persona and memory', () => {
    const history: ChatMessage[] = [{ role: 'user', content: 'a' }];
    const result = buildContext('sys', history, 'c', 50, undefined, {
      sourceBand: '<source_context>Discord</source_context>',
      attachmentBand: '<attachments>\n- url: https://x/y.png\n</attachments>',
      personaBand: '<persona_grounding></persona_grounding>',
      memoryBand: '[memory: 1 recalled]',
      kbBand: null,
    });
    expect(result.map((m) => m.content)).toEqual([
      'sys',
      '<source_context>Discord</source_context>',
      '<attachments>\n- url: https://x/y.png\n</attachments>',
      '<persona_grounding></persona_grounding>',
      '[memory: 1 recalled]',
      'a',
      'c',
    ]);
  });
});
