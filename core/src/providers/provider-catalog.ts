import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseSecretReference } from '../secrets/reference';

/** One LLM provider in the catalog (S4). */
export interface ProviderEntry {
  id: string;
  baseUrl: string;
  model: string;
  /**
   * Reference to the API key (`$VAR` env or `secret:NAME` vault).
   * Literals are rejected — the catalog holds references, never values.
   */
  apiKeyRef?: string;
  /** Extra headers; every value must be a reference too. */
  headers?: Record<string, string>;
  userAgent?: string;
  timeoutMs?: number;
  enabled?: boolean;
}

export type ProviderRole = 'conversation' | 'memory';

export interface ProviderCatalog {
  active: { conversation?: string; memory?: string };
  providers: ProviderEntry[];
  /** Human-readable validation failures (bad entries are skipped). */
  errors: string[];
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return ID_PATTERN.test(id) ? id : null;
}

function validUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    new URL(value.trim());
    return value.trim();
  } catch {
    return null;
  }
}

function cleanReferenceMap(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key.trim() || typeof entry !== 'string') return null;
    if (!parseSecretReference(entry)) return null;
    out[key] = entry;
  }
  return out;
}

function validateEntry(
  raw: unknown,
): { entry: ProviderEntry } | { error: string } {
  if (!isRecord(raw)) return { error: 'provider entry must be an object' };
  const id = cleanId(raw['id']);
  if (!id) return { error: 'provider needs a dns-like id' };
  const baseUrl = validUrl(raw['baseUrl']);
  if (!baseUrl) return { error: `provider "${id}": baseUrl must be a URL` };
  if (typeof raw['model'] !== 'string' || !raw['model'].trim()) {
    return { error: `provider "${id}": model is required` };
  }
  const entry: ProviderEntry = { id, baseUrl, model: raw['model'].trim() };
  if (raw['apiKeyRef'] !== undefined) {
    if (
      typeof raw['apiKeyRef'] !== 'string' ||
      !parseSecretReference(raw['apiKeyRef'])
    ) {
      return {
        error: `provider "${id}": apiKeyRef must be a $VAR or secret: reference`,
      };
    }
    entry.apiKeyRef = raw['apiKeyRef'];
  }
  if (raw['headers'] !== undefined) {
    const headers = cleanReferenceMap(raw['headers']);
    if (!headers) {
      return {
        error: `provider "${id}": header values must be references`,
      };
    }
    entry.headers = headers;
  }
  if (raw['userAgent'] !== undefined) {
    if (typeof raw['userAgent'] !== 'string') {
      return { error: `provider "${id}": userAgent must be a string` };
    }
    entry.userAgent = raw['userAgent'];
  }
  if (raw['timeoutMs'] !== undefined) {
    if (
      typeof raw['timeoutMs'] !== 'number' ||
      !Number.isInteger(raw['timeoutMs']) ||
      raw['timeoutMs'] <= 0
    ) {
      return {
        error: `provider "${id}": timeoutMs must be a positive integer`,
      };
    }
    entry.timeoutMs = raw['timeoutMs'];
  }
  if (raw['enabled'] !== undefined) {
    if (typeof raw['enabled'] !== 'boolean') {
      return { error: `provider "${id}": enabled must be boolean` };
    }
    entry.enabled = raw['enabled'];
  }
  return { entry };
}

/**
 * Parse a provider catalog. Invalid entries are reported and skipped —
 * one bad provider never blocks the rest. Duplicate ids keep the first.
 */
export function parseProviderCatalog(raw: unknown): ProviderCatalog {
  const providers: ProviderEntry[] = [];
  const errors: string[] = [];
  const active: { conversation?: string; memory?: string } = {};
  if (!isRecord(raw)) {
    return { active, providers, errors: ['catalog root must be an object'] };
  }
  const list = raw['providers'];
  if (!Array.isArray(list)) {
    return { active, providers, errors: ['"providers" must be an array'] };
  }
  const seen = new Set<string>();
  for (const item of list) {
    const result = validateEntry(item);
    if ('error' in result) {
      errors.push(result.error);
      continue;
    }
    if (seen.has(result.entry.id)) {
      errors.push(`duplicate provider "${result.entry.id}" (first wins)`);
      continue;
    }
    seen.add(result.entry.id);
    providers.push(result.entry);
  }
  if (raw['active'] !== undefined) {
    if (!isRecord(raw['active'])) {
      errors.push('"active" must be an object');
    } else {
      for (const role of ['conversation', 'memory'] as const) {
        const value = raw['active'][role];
        if (value === undefined) continue;
        const id = cleanId(value);
        if (!id) {
          errors.push(`active.${role} is not a valid provider id`);
          continue;
        }
        if (!seen.has(id)) {
          errors.push(`active.${role} references unknown provider "${id}"`);
          continue;
        }
        active[role] = id;
      }
    }
  }
  return { active, providers, errors };
}

/** Default catalog location inside the shared instance data root. */
export function defaultProvidersPath(): string {
  return join(homedir(), '.icos', 'providers.json');
}

/** Validate one entry as the catalog file would (S5 write path). */
export function validateProviderEntry(
  raw: unknown,
): { entry: ProviderEntry } | { error: string } {
  return validateEntry(raw);
}

interface RawProviderFile {
  active: { conversation?: string; memory?: string };
  providers: unknown[];
}

/** Raw file contents (never throws; absent/corrupt = empty). */
export function readProviderRaw(path: string): RawProviderFile {
  const empty: RawProviderFile = { active: {}, providers: [] };
  if (!existsSync(path)) return empty;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!isRecord(parsed)) return empty;
    const active: { conversation?: string; memory?: string } = {};
    if (isRecord(parsed['active'])) {
      for (const role of ['conversation', 'memory'] as const) {
        const value = parsed['active'][role];
        if (typeof value === 'string') active[role] = value;
      }
    }
    return {
      active,
      providers: Array.isArray(parsed['providers']) ? parsed['providers'] : [],
    };
  } catch {
    return empty;
  }
}

/** Atomically write the provider catalog (temp + rename). */
export function writeProviderFile(
  path: string,
  active: { conversation?: string; memory?: string },
  providers: unknown[],
): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ active, providers }, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(tmp, path);
}

function toRawProvider(entry: ProviderEntry): Record<string, unknown> {
  return {
    id: entry.id,
    baseUrl: entry.baseUrl,
    model: entry.model,
    ...(entry.apiKeyRef !== undefined ? { apiKeyRef: entry.apiKeyRef } : {}),
    ...(entry.headers !== undefined ? { headers: entry.headers } : {}),
    ...(entry.userAgent !== undefined ? { userAgent: entry.userAgent } : {}),
    ...(entry.timeoutMs !== undefined ? { timeoutMs: entry.timeoutMs } : {}),
    ...(entry.enabled !== undefined ? { enabled: entry.enabled } : {}),
  };
}

/** Insert or replace a provider by id, preserving order. */
export function upsertProviderEntry(
  providers: unknown[],
  entry: ProviderEntry,
): unknown[] {
  const raw = toRawProvider(entry);
  const index = providers.findIndex(
    (item) => isRecord(item) && item['id'] === entry.id,
  );
  const next = [...providers];
  if (index >= 0) next[index] = raw;
  else next.push(raw);
  return next;
}

/** Remove a provider by id (no-op when absent). */
export function removeProviderEntry(
  providers: unknown[],
  id: string,
): unknown[] {
  return providers.filter((item) => !(isRecord(item) && item['id'] === id));
}

/** Resolve the configured providers path (empty → default). */
export function resolveProvidersPath(rawPath: string | undefined): string {
  const path = (rawPath ?? '').trim() || defaultProvidersPath();
  return path.startsWith('~/')
    ? join(homedir(), path.slice(2))
    : resolve(process.cwd(), path);
}

export interface LoadedProviderCatalog extends ProviderCatalog {
  path: string;
}

/**
 * Load the catalog file. Absent file = empty catalog (env-only
 * behavior exactly). Unparseable file = empty catalog with the error
 * reported, never a boot failure.
 */
export function loadProviderCatalog(
  rawPath: string | undefined,
): LoadedProviderCatalog {
  const resolved = resolveProvidersPath(rawPath);
  if (!existsSync(resolved)) {
    return { active: {}, providers: [], errors: [], path: '' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolved, 'utf8')) as unknown;
  } catch {
    return {
      active: {},
      providers: [],
      errors: [`provider catalog at ${resolved} is not valid JSON`],
      path: resolved,
    };
  }
  const catalog = parseProviderCatalog(parsed);
  return { ...catalog, path: resolved };
}
