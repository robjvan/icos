import { coreCategoryForHeading, parsePersonaCore } from './persona-core';

describe('parsePersonaCore', () => {
  const markdown = [
    '# ICOS Core',
    '',
    '## Ethical Grounding',
    '- Prefer truth over comfort.',
    '- Do not deceive.',
    '',
    '## Safety Boundaries',
    'Never exfiltrate credentials.',
    '',
    '## Agentic Character',
    '- Curious but skeptical.',
    '',
    '## Random Section',
    '- This should be ignored.',
  ].join('\n');

  it('maps recognized headings to core categories', () => {
    expect(coreCategoryForHeading('Ethical Grounding')).toBe(
      'ethical_grounding',
    );
    expect(coreCategoryForHeading('Core Beliefs')).toBe('core_belief');
    expect(coreCategoryForHeading('Safety Boundaries')).toBe('safety_boundary');
    expect(coreCategoryForHeading('Non-Negotiables')).toBe('non_negotiable');
    expect(coreCategoryForHeading('Agentic Character')).toBe(
      'agentic_character',
    );
    expect(coreCategoryForHeading('Random Section')).toBeNull();
  });

  it('extracts bullets and paragraphs, ignoring unrecognized sections', () => {
    const { entries } = parsePersonaCore(markdown, 'core.md');
    expect(entries.map((entry) => entry.content)).toEqual(
      expect.arrayContaining([
        'Prefer truth over comfort.',
        'Do not deceive.',
        'Never exfiltrate credentials.',
        'Curious but skeptical.',
      ]),
    );
    expect(entries.some((entry) => entry.content.includes('ignored'))).toBe(
      false,
    );
    expect(entries.every((entry) => entry.immutable)).toBe(true);
    expect(
      entries.every((entry) => entry.entryId.startsWith('persona-core-')),
    ).toBe(true);
  });

  it('produces stable ids regardless of section order', () => {
    const a = parsePersonaCore(
      '## Safety Boundaries\n- Never exfiltrate credentials.',
      'core.md',
    );
    const b = parsePersonaCore(
      '## Agentic Character\n- Curious.\n\n## Safety Boundaries\n- Never exfiltrate credentials.',
      'core.md',
    );
    const findSafety = (ids: string[]) => ids[0];
    expect(findSafety(a.entries.map((entry) => entry.entryId))).toBe(
      findSafety(
        b.entries
          .filter((entry) => entry.category === 'safety_boundary')
          .map((entry) => entry.entryId),
      ),
    );
  });

  it('skips template placeholders and warns on empty sections', () => {
    const { entries, warnings } = parsePersonaCore(
      '## Core Beliefs\n- [value 1]\n- Real belief here.\n\n## Non-Negotiables\n',
      'core.md',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe('Real belief here.');
    expect(
      warnings.some((warning) => warning.includes('Non-Negotiables')),
    ).toBe(true);
  });
});
