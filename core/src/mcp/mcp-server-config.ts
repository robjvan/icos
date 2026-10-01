import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export type McpTransport = 'stdio' | 'http';

export const MCP_TRANSPORTS: readonly McpTransport[] = ['stdio', 'http'];

/** One MCP server in the catalog file. */
export interface McpServerEntry {
  /** DNS-ish name, used in tool namespaces (`mcp_<name>_<tool>`). */
  name: string;
  transport: McpTransport;
  /** stdio: executable. http: unused. */
  command?: string;
  /** stdio: argv. http: unused. */
  args?: string[];
  /** Streamable HTTP endpoint. stdio: unused. */
  url?: string;
  /**
   * Extra env for spawned servers. Secrets stay out of the file:
   * every value must be a process-env reference (`"$VAR"` or
   * `"${VAR}"`), resolved at spawn. Literals are rejected at
   * validation — an API key in this file would be a persisted
   * secret, and the catalog is frontend-editable by design (M13d).
   */
  env?: Record<string, string>;
  /** False skips the server without error. Default true. */
  enabled?: boolean;
  /** Approval override for this server's tools (default: required). */
  approval?: 'required' | 'none';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().toLowerCase();
  if (!NAME_PATTERN.test(name) || name.length > 64) return null;
  return name;
}

function cleanStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.some((item) => typeof item !== 'string')) return null;
  return [...(value as string[])];
}

function cleanEnv(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key.trim() || typeof entry !== 'string') return null;
    if (!parseEnvReference(entry)) return null;
    env[key] = entry;
  }
  return env;
}

/**
 * A process-env reference: `$NAME` or `${NAME}` (shell-shaped,
 * nothing fancier). Anything else — including a literal secret —
 * is rejected: secrets live in the operator's environment, never
 * in the catalog file.
 */
export function parseEnvReference(value: string): { name: string } | null {
  const bare = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(value.trim());
  if (bare?.[1]) return { name: bare[1] };
  const braced = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value.trim());
  if (braced?.[1]) return { name: braced[1] };
  return null;
}

/**
 * Resolve a validated `env` map against the process environment
 * (at spawn time, never earlier — the operator may rotate vars
 * between boot and reconnect). Missing or empty vars throw naming
 * only the variable, never any value. There is no fallback and
 * no empty-string default: a server that needs a secret it
 * cannot have fails closed before spawning.
 */
export function resolveServerEnv(
  env: Record<string, string> | undefined,
  serverName: string,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, reference] of Object.entries(env ?? {})) {
    const parsed = parseEnvReference(reference);
    if (!parsed) {
      throw new Error(
        `MCP server "${serverName}": env "${key}" is not a $VAR reference`,
      );
    }
    const value = process.env[parsed.name];
    if (!value) {
      throw new Error(
        `MCP server "${serverName}": env "${key}" needs $${parsed.name} in the process environment`,
      );
    }
    resolved[key] = value;
  }
  return resolved;
}

function validateOne(
  raw: unknown,
): { entry: McpServerEntry } | { error: string } {
  if (!isRecord(raw)) return { error: 'entry must be an object' };
  const name = cleanName(raw['name']);
  if (!name) return { error: 'entry needs a dns-like name' };
  const transport = raw['transport'];
  if (transport !== 'stdio' && transport !== 'http') {
    return { error: `server "${name}": transport must be stdio or http` };
  }
  const entry: McpServerEntry = { name, transport };
  if (transport === 'stdio') {
    if (typeof raw['command'] !== 'string' || !raw['command'].trim()) {
      return { error: `server "${name}": stdio needs a command` };
    }
    entry.command = raw['command'].trim();
    if (raw['args'] !== undefined) {
      const args = cleanStringArray(raw['args']);
      if (!args) return { error: `server "${name}": args must be strings` };
      entry.args = args;
    }
    if (raw['env'] !== undefined) {
      const env = cleanEnv(raw['env']);
      if (!env) {
        return {
          error:
            `server "${name}": env values must be process-env references ` +
            `("$VAR"), never literals`,
        };
      }
      entry.env = env;
    }
  } else {
    if (typeof raw['url'] !== 'string' || !raw['url'].trim()) {
      return { error: `server "${name}": http needs a url` };
    }
    entry.url = raw['url'].trim();
    if (raw['env'] !== undefined) {
      return {
        error: `server "${name}": env is stdio-only (no child to spawn)`,
      };
    }
  }
  if (raw['enabled'] !== undefined) {
    if (typeof raw['enabled'] !== 'boolean') {
      return { error: `server "${name}": enabled must be boolean` };
    }
    entry.enabled = raw['enabled'];
  }
  if (raw['approval'] !== undefined) {
    if (raw['approval'] !== 'required' && raw['approval'] !== 'none') {
      return { error: `server "${name}": approval must be required or none` };
    }
    entry.approval = raw['approval'];
  }
  return { entry };
}

export interface McpCatalog {
  entries: McpServerEntry[];
  /** Human-readable validation failures (bad entries are skipped). */
  errors: string[];
}

/**
 * Parse catalog JSON (array of entries). Invalid entries are
 * reported and skipped — one bad server never blocks the rest.
 * Duplicate names keep the first, reported.
 */
export function parseCatalog(raw: unknown): McpCatalog {
  const entries: McpServerEntry[] = [];
  const errors: string[] = [];
  const items: unknown[] = Array.isArray(raw) ? raw : [];
  if (!Array.isArray(raw)) {
    return { entries, errors: ['catalog root must be an array'] };
  }
  const seen = new Set<string>();
  for (const item of items) {
    const result = validateOne(item);
    if ('error' in result) {
      errors.push(result.error);
      continue;
    }
    if (seen.has(result.entry.name)) {
      errors.push(`duplicate server "${result.entry.name}" (first wins)`);
      continue;
    }
    seen.add(result.entry.name);
    entries.push(result.entry);
  }
  return { entries, errors };
}

/** Default catalog location inside the shared instance data root. */
export function defaultCatalogPath(): string {
  return join(homedir(), '.icos', 'mcp-servers.json');
}

export interface LoadedCatalog extends McpCatalog {
  /** Resolved file path (empty when the file is absent). */
  path: string;
}

/**
 * Load the catalog file. Absent file = empty catalog (current
 * behavior exactly — MCP stays out of the way until configured).
 * Unparseable file = empty catalog with the error reported (loud,
 * never a boot failure).
 */
export function loadCatalogFile(rawPath: string | undefined): LoadedCatalog {
  const path = (rawPath ?? '').trim() || defaultCatalogPath();
  const resolved = path.startsWith('~/')
    ? join(homedir(), path.slice(2))
    : resolve(process.cwd(), path);
  if (!existsSync(resolved)) return { entries: [], errors: [], path: '' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolved, 'utf8')) as unknown;
  } catch {
    return {
      entries: [],
      errors: [`catalog at ${resolved} is not valid JSON`],
      path: resolved,
    };
  }
  const catalog = parseCatalog(parsed);
  return { ...catalog, path: resolved };
}
