import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import type { SkillDescriptor, SkillSkipped } from './skill.types';

/** Entry file per skill directory (case-sensitive). */
export const SKILL_FILE = 'SKILL.md';

/** Skill names are kebab-case, 1–64 chars, and must equal the directory. */
export const NAME_PATTERN = /^[a-z0-9-]{1,64}$/;

/** Maximum directory depth searched under the skills root (M18). */
const MAX_SKILL_DEPTH = 4;

/** Frontmatter description cap: one-line capability summary. */
export const MAX_DESCRIPTION_CHARS = 500;

/** Frontmatter version cap: informational label only. */
export const MAX_VERSION_CHARS = 64;

/** Machine-readable validation failure. `reason` is the skip code
 * reported by `/skills` and the inspection endpoints. */
export class SkillParseError extends Error {
  constructor(
    readonly reason: string,
    detail: string,
  ) {
    super(`${reason}: ${detail}`);
    this.name = 'SkillParseError';
  }
}

export interface ParsedSkillFile {
  name: string;
  description: string;
  version: string;
  body: string;
}

const KNOWN_FRONTMATTER_KEYS = new Set(['name', 'description', 'version']);

function unquote(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Minimal `---`-delimited frontmatter parser. Reads the three known keys
 * (`name`, `description`, `version`) and **tolerates everything else** (M18):
 * unknown keys, list items, and nested/indented blocks (e.g. `metadata:`) are
 * ignored, so a real-world skill library loads without per-file rewriting.
 * Duplicate known keys still fail closed.
 */
export function parseSkillFile(
  raw: string,
  opts: { maxBodyChars: number },
): ParsedSkillFile {
  const normalized = raw.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0]?.trim() !== '---') {
    throw new SkillParseError('bad-frontmatter', 'missing opening --- marker');
  }
  const closing = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---',
  );
  if (closing < 0) {
    throw new SkillParseError('bad-frontmatter', 'missing closing --- marker');
  }
  const seen = new Map<string, string>();
  for (const line of lines.slice(1, closing)) {
    // Indented lines belong to a nested block (e.g. `metadata:`); skip them.
    if (/^\s/.test(line)) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(trimmed);
    if (!match) continue; // tolerate list items / other top-level scalars
    const key = match[1];
    if (!KNOWN_FRONTMATTER_KEYS.has(key)) continue; // tolerate unknown keys
    if (seen.has(key)) {
      throw new SkillParseError('bad-frontmatter', `duplicate key "${key}"`);
    }
    seen.set(key, unquote(match[2].trim()));
  }
  const name = seen.get('name') ?? '';
  if (!NAME_PATTERN.test(name)) {
    throw new SkillParseError(
      'bad-name',
      `"${name}" must match ${String(NAME_PATTERN)}`,
    );
  }
  const description = seen.get('description') ?? '';
  if (!description) {
    throw new SkillParseError('missing-description', 'description is empty');
  }
  if (description.length > MAX_DESCRIPTION_CHARS) {
    throw new SkillParseError(
      'description-too-long',
      `${description.length} chars exceeds ${MAX_DESCRIPTION_CHARS}`,
    );
  }
  const version = seen.get('version') || '0.0.0';
  if (version.length > MAX_VERSION_CHARS) {
    throw new SkillParseError(
      'bad-frontmatter',
      `version exceeds ${MAX_VERSION_CHARS} chars`,
    );
  }
  const body = lines
    .slice(closing + 1)
    .join('\n')
    .trim();
  if (!body) {
    throw new SkillParseError('empty-body', 'skill body is empty');
  }
  if (body.length > opts.maxBodyChars) {
    throw new SkillParseError(
      'body-too-large',
      `${body.length} chars exceeds ${opts.maxBodyChars}`,
    );
  }
  return { name, description, version, body };
}

export interface SkillScanResult {
  dir: string;
  descriptors: SkillDescriptor[];
  skipped: SkillSkipped[];
}

/**
 * Scan a skills directory into validated descriptors. Walks the tree
 * recursively (M18), so skills may sit at the root or under category
 * directories (`<root>/<category>/<name>/SKILL.md`). A skill is any directory
 * containing `SKILL.md`, and its frontmatter `name` must equal the directory
 * name. Bodies are (re-)read on explicit `loadSkillBody()`. A missing
 * directory is a valid empty catalog. Symlinked entries are skipped, never
 * followed.
 */
export async function scanSkillDir(
  dir: string,
  opts: { maxBodyChars: number },
): Promise<SkillScanResult> {
  const descriptors: SkillDescriptor[] = [];
  const skipped: SkillSkipped[] = [];
  const seen = new Set<string>();

  const visit = async (
    current: string,
    relPath: string,
    depth: number,
  ): Promise<void> => {
    if (depth > MAX_SKILL_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const entry of [...entries].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name.startsWith('.')) continue;
      const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(join(current, entry.name), childRel, depth + 1);
        continue;
      }
      if (!entry.isFile() || entry.name !== SKILL_FILE) continue;
      const dirName = relPath.split('/').pop() ?? '';
      let parsed: ParsedSkillFile;
      try {
        parsed = parseSkillFile(
          await fs.readFile(join(current, entry.name), 'utf8'),
          opts,
        );
      } catch (err) {
        skipped.push({
          name: dirName,
          reason: err instanceof SkillParseError ? err.reason : 'unreadable',
        });
        continue;
      }
      if (parsed.name !== dirName) {
        skipped.push({ name: dirName, reason: 'name-mismatch' });
        continue;
      }
      const key = parsed.name.toLowerCase();
      if (seen.has(key)) {
        skipped.push({ name: dirName, reason: 'duplicate' });
        continue;
      }
      seen.add(key);
      descriptors.push({
        name: parsed.name,
        description: parsed.description,
        version: parsed.version,
        path: relPath,
        ...(relPath.includes('/') ? { category: relPath.split('/')[0] } : {}),
      });
    }
  };

  await visit(dir, '', 0);
  return { dir, descriptors, skipped };
}

/**
 * Read + validate one skill body from its canonical location (a directory
 * path relative to the skills root). Explicit operation — discovery and
 * catalog listing never call this.
 */
export async function loadSkillBody(
  root: string,
  relPath: string,
  opts: { maxBodyChars: number },
): Promise<ParsedSkillFile> {
  const raw = await fs.readFile(join(root, relPath, SKILL_FILE), 'utf8');
  const parsed = parseSkillFile(raw, opts);
  const dirName = relPath.split('/').pop() ?? '';
  if (parsed.name !== dirName) {
    throw new SkillParseError(
      'name-mismatch',
      `directory "${relPath}" declares name "${parsed.name}"`,
    );
  }
  return parsed;
}
