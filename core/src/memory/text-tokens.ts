/**
 * Shared tokenization for the recall surfaces (M11a). Deliberately
 * dumb and documented: lowercase alphanumeric tokens. The stopword
 * set is minimal and frozen — negation words (`not`, `no`, `never`,
 * `n't`) are NEVER stopped: a dropped negation is a flipped belief.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'to',
  'of',
  'in',
  'on',
  'and',
  'or',
  'for',
  'with',
  'it',
  'its',
  'this',
  'that',
]);

/** Lowercase alphanumeric tokens with stopwords removed. */
export function tokenize(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0 && !STOPWORDS.has(token));
  return [...new Set(tokens)];
}
