/**
 * Cheap lexical similarity for structural drift (M15b): used to decide
 * whether pending candidates form a "repeated pressure" cluster. This is
 * a baseline measure on purpose — M15c adds real embeddings and reports
 * this alongside them so the roadmap can compare.
 */

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

/** Content tokens in order, with repeats: lowercased, punctuation removed. */
export function contentTokenList(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

/** Content tokens as a set: lowercased, punctuation-stripped, stop-words removed. */
export function contentTokens(value: string): Set<string> {
  return new Set(contentTokenList(value));
}

/**
 * Jaccard overlap of content tokens in [0, 1]. 0 when either side has no
 * content tokens, 1 when the token sets are identical.
 */
export function tokenOverlap(left: string, right: string): number {
  const a = contentTokens(left);
  const b = contentTokens(right);
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}
