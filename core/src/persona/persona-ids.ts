import { createHash } from 'node:crypto';

/**
 * Deterministic id from content. Deterministic (not random) so that
 * staging, seed import, and the core parser are idempotent: the same
 * input always maps to the same row, never a duplicate.
 */
export function createId(prefix: string, value: string): string {
  const digest = createHash('sha256').update(value).digest('hex');
  return `${prefix}-${digest.slice(0, 24)}`;
}
