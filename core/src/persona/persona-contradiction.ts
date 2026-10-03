/**
 * Conservative contradiction heuristic (M14f), ported from the v2
 * coherence engine. Two statements contradict when they share enough
 * content words and their negation polarity differs.
 *
 * Deliberately narrow: it errs toward "not a contradiction", so it can
 * gate a refusal but never silently rewrite. M15 formalizes structural /
 * semantic drift; this stays the cheap deterministic first pass.
 *
 * Note: id/statement here are the two texts to compare — typically an
 * immutable core entry and a candidate observation.
 */
export function statementsContradict(left: string, right: string): boolean {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.size < 2 || rightTokens.size < 2) {
    return false;
  }
  const common = [...leftTokens].filter((token) => rightTokens.has(token));
  const overlap = common.length / Math.min(leftTokens.size, rightTokens.size);
  return overlap >= 0.5 && hasNegation(left) !== hasNegation(right);
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'be',
  'but',
  'for',
  'i',
  'is',
  'it',
  'of',
  'or',
  'that',
  'the',
  'this',
  'to',
  'we',
  'you',
]);

const NEGATION_WORDS = new Set(['not', 'never', 'dont', 'doesnt', 'no']);

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(
        (token) =>
          token.length > 2 &&
          !STOP_WORDS.has(token) &&
          !NEGATION_WORDS.has(token),
      ),
  );
}

function hasNegation(value: string): boolean {
  return /\b(?:not|never|no longer|do not|does not|don't|doesn't|dislike|hate|reject)\b/i.test(
    value,
  );
}
