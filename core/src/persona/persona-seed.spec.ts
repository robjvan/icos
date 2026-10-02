import { parsePersonaSeed, seedSectionPolicy } from './persona-seed';

describe('parsePersonaSeed', () => {
  it('maps seed headings to category, sensitivity, protection, and layer', () => {
    expect(seedSectionPolicy('Core Values', 'persona')).toMatchObject({
      category: 'value',
      protected: true,
      layer: 'agentic_character',
    });
    expect(seedSectionPolicy('Boundaries', 'persona')).toMatchObject({
      category: 'boundary',
      sensitivity: 'protected',
      protected: true,
    });
    expect(seedSectionPolicy('Direction', 'soul')).toMatchObject({
      category: 'commitment',
      protected: false,
    });
    expect(seedSectionPolicy('Relationship Notes', 'persona')).toMatchObject({
      category: 'relationship',
    });
    expect(seedSectionPolicy('Random Section', 'soul')).toBeNull();
  });

  it('treats unrecognized persona headings as self, but not soul', () => {
    expect(seedSectionPolicy('Favorite Things', 'persona')).toMatchObject({
      category: 'self',
      layer: 'persona',
    });
    expect(seedSectionPolicy('Favorite Things', 'soul')).toBeNull();
    expect(seedSectionPolicy('Current Self', 'soul')).toMatchObject({
      layer: 'soul_seed',
    });
  });

  it('skips signature moments in persona files', () => {
    expect(seedSectionPolicy('Signature Moments', 'persona')).toBeNull();
  });

  it('parses statements into distinct keyed candidates', () => {
    const candidates = parsePersonaSeed(
      '## Boundaries\n- One clear boundary here.\n- Another boundary line.',
      'persona',
    );
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      category: 'boundary',
      protected: true,
    });
    expect(candidates[0].key).toBeDefined();
    expect(candidates[0].key).not.toBe(candidates[1].key);
  });
});
