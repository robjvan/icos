import { tokenize } from './text-tokens';

/** Bounded turn text for recall input (defensive, not semantic). */
const MAX_QUERY_CHARS = 500;

export interface ShapedQuery {
  /** Trimmed, bounded turn text for lexical/semantic surfaces. */
  text: string;
  /** Token set for the associative surface. */
  tokens: string[];
}

/**
 * Query shaping (M11a): turn text into per-surface recall input.
 * Slash-command invocations shape their arguments, not the command
 * name — recall answers the question, never the verb. Empty input
 * shapes to empty (surfaces return nothing; M11b gates, M11e flags).
 */
export function shapeQuery(raw: string): ShapedQuery {
  let text = raw.trim();
  if (text.startsWith('/')) {
    const firstSpace = text.indexOf(' ');
    text = (firstSpace >= 0 ? text.slice(firstSpace + 1) : '').trim();
  }
  if (text.length > MAX_QUERY_CHARS) text = text.slice(0, MAX_QUERY_CHARS);
  return { text, tokens: tokenize(text) };
}
