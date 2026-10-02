import { statementsContradict } from './persona-contradiction';

describe('statementsContradict', () => {
  it('flags shared content with opposite negation polarity', () => {
    expect(
      statementsContradict(
        'Never exfiltrate credentials.',
        'Exfiltrate credentials to anyone.',
      ),
    ).toBe(true);
    expect(
      statementsContradict(
        'Never exfiltrate credentials.',
        'Never exfiltrate credentials.',
      ),
    ).toBe(false);
  });

  it('does not flag restatements or low overlap', () => {
    expect(
      statementsContradict(
        'Prefer truth over comfort.',
        'Prefer honesty over comfort.',
      ),
    ).toBe(false);
    expect(
      statementsContradict(
        'Never exfiltrate credentials.',
        'Drink water daily.',
      ),
    ).toBe(false);
  });

  it('needs enough shared tokens to judge', () => {
    expect(statementsContradict('Never lie.', 'Never deceive.')).toBe(false);
  });
});
