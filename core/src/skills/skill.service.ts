import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import {
  loadSkillBody,
  scanSkillDir,
  NAME_PATTERN,
  MAX_DESCRIPTION_CHARS,
  SKILL_FILE,
  parseSkillFile,
} from './skill-loader';
import type { ParsedSkillFile } from './skill-loader';
import { discoverSkills } from './skill-discovery';
import { TopBudgetedSelector } from './skill-selector';
import type { SkillSelector } from './skill-selector';
import type {
  LoadedSkill,
  SkillDescriptor,
  SkillLoadReport,
  SkillMatch,
  TurnSkillReport,
} from './skill.types';

/**
 * Bodies resolved for one conversation turn: pinned explicit skills,
 * staged one-shots, then budgeted auto-discovery — plus every discovery
 * candidate considered (admitted or budget-rejected) for observability.
 */
export interface ResolvedTurnSkills {
  explicit: LoadedSkill[];
  requested: LoadedSkill[];
  contextual: LoadedSkill[];
  considered: SkillMatch[];
}

/**
 * Filesystem skill registry (M7a). Owns validated descriptors in memory
 * plus a body cache; the filesystem stays the writer. No LLM contact, no
 * SQLite, no transcript writes. Disabled mode behaves as an empty catalog.
 */
@Injectable()
export class SkillService implements OnModuleInit {
  private readonly logger = new Logger(SkillService.name);
  private descriptors = new Map<string, SkillDescriptor>();
  private bodies = new Map<string, LoadedSkill>();
  private report: SkillLoadReport = {
    dir: '',
    scanned: 0,
    loaded: 0,
    skipped: [],
  };
  /** Session-pinned skill names (canonical), keyed by session id. */
  private explicit = new Map<string, Set<string>>();
  /** Staged one-shot requests (canonical names), consumed by the next turn. */
  private pending = new Map<string, Set<string>>();
  /** Last completed turn's injection record, keyed by session id. */
  private lastTurn = new Map<string, TurnSkillReport>();
  /** Sessions where skills are explicitly turned off (M18.x). */
  private readonly sessionDisabled = new Set<string>();
  private readonly selector: SkillSelector = new TopBudgetedSelector();

  constructor(@Inject(CORE_CONFIG) private readonly config: CoreConfig) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  get enabled(): boolean {
    return this.config.skillsEnabled === true;
  }

  get skillsDir(): string {
    return this.config.skillsDirPath;
  }

  /** Re-scan the catalog from disk, replacing registry state and dropping
   * the body cache. Idempotent. Never throws on invalid content — skips
   * are reported, not raised. */
  async refresh(): Promise<SkillLoadReport> {
    const dir = this.config.skillsDirPath;
    if (!this.enabled || !dir) {
      this.descriptors = new Map();
      this.bodies = new Map();
      this.report = { dir: dir ?? '', scanned: 0, loaded: 0, skipped: [] };
      return this.report;
    }
    const scanned = await scanSkillDir(dir, {
      maxBodyChars: this.config.skillsMaxBodyChars,
    });
    const next = new Map<string, SkillDescriptor>();
    for (const descriptor of scanned.descriptors) {
      next.set(descriptor.name.toLowerCase(), descriptor);
    }
    this.descriptors = next;
    this.bodies = new Map();
    this.report = {
      dir,
      scanned: scanned.descriptors.length + scanned.skipped.length,
      loaded: scanned.descriptors.length,
      skipped: scanned.skipped,
    };
    if (scanned.skipped.length > 0) {
      this.logger.warn(
        `Skills refresh skipped ${scanned.skipped.length}: ${scanned.skipped
          .map((s) => `${s.name} (${s.reason})`)
          .join(', ')}`,
      );
    }
    return this.report;
  }

  /** Last scan outcome, including skip reasons. */
  getReport(): SkillLoadReport {
    return this.report;
  }

  /**
   * M17c.3 skill_manage: create a skill directory + SKILL.md. Guarded:
   * kebab-case name, bounded description/body, a light content scan, and
   * authoritative validation by the loader's own parser **before** any
   * write, so a rejected skill leaves nothing on disk.
   */
  async createSkill(input: {
    name: string;
    description: string;
    body: string;
  }): Promise<SkillDescriptor> {
    this.requireEnabled();
    const content = this.buildSkillFile(input);
    if (this.descriptors.has(input.name.toLowerCase())) {
      throw new BadRequestException(`Skill "${input.name}" already exists`);
    }
    // Managed skills are written flat at the root (still discovered
    // recursively); shipped skills keep their category paths.
    const dir = join(this.skillsDir, input.name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, SKILL_FILE), content, { mode: 0o600 });
    return this.reloadAndRequire(input.name);
  }

  /**
   * Replace an existing skill's SKILL.md (guarded like create). The body and
   * description are replaced; every other frontmatter key (version, author,
   * license, metadata, …) is preserved, so editing a shipped skill does not
   * strip its metadata.
   */
  async updateSkill(input: {
    name: string;
    description: string;
    body: string;
  }): Promise<SkillDescriptor> {
    this.requireEnabled();
    const descriptor = this.descriptors.get(input.name.toLowerCase());
    if (!descriptor) {
      throw new NotFoundException(`Unknown skill "${input.name}"`);
    }
    const description = input.description.replace(/\s+/g, ' ').trim();
    if (!description) {
      throw new BadRequestException('description is required');
    }
    if (description.length > MAX_DESCRIPTION_CHARS) {
      throw new BadRequestException(
        `description exceeds ${MAX_DESCRIPTION_CHARS} chars`,
      );
    }
    const body = input.body.replace(/\r\n/g, '\n').trim();
    if (!body) {
      throw new BadRequestException('body is required');
    }
    this.scanSkillContent(body);
    const dir = join(this.skillsDir, descriptor.path ?? descriptor.name);
    const file = join(dir, SKILL_FILE);
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch {
      throw new NotFoundException(`Skill "${input.name}" is unavailable`);
    }
    const content = mergeSkillFile(raw, descriptor.name, description, body);
    try {
      parseSkillFile(content, { maxBodyChars: this.config.skillsMaxBodyChars });
    } catch (err) {
      throw new BadRequestException(
        `invalid skill: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
    await fs.writeFile(file, content, { mode: 0o600 });
    return this.reloadAndRequire(input.name);
  }

  /** Delete a skill directory (recursive). */
  async deleteSkill(name: string): Promise<void> {
    this.requireEnabled();
    const descriptor = this.descriptors.get(name.toLowerCase());
    if (!descriptor) {
      throw new NotFoundException(`Unknown skill "${name}"`);
    }
    await fs.rm(join(this.skillsDir, descriptor.path ?? descriptor.name), {
      recursive: true,
      force: true,
    });
    await this.refresh();
  }

  private requireEnabled(): void {
    if (!this.enabled) {
      throw new BadRequestException(
        'Skills are disabled (SKILLS_ENABLED=false).',
      );
    }
  }

  /** Build and validate a SKILL.md; rejects before anything is written. */
  private buildSkillFile(input: {
    name: string;
    description: string;
    body: string;
  }): string {
    const name = input.name.trim();
    if (!NAME_PATTERN.test(name)) {
      throw new BadRequestException(
        'skill name must be kebab-case (a-z0-9-, 1-64 chars)',
      );
    }
    const description = input.description.replace(/\s+/g, ' ').trim();
    if (!description) {
      throw new BadRequestException('description is required');
    }
    if (description.length > MAX_DESCRIPTION_CHARS) {
      throw new BadRequestException(
        `description exceeds ${MAX_DESCRIPTION_CHARS} chars`,
      );
    }
    const body = input.body.replace(/\r\n/g, '\n').trim();
    if (!body) {
      throw new BadRequestException('body is required');
    }
    this.scanSkillContent(body);
    const content = `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
    try {
      parseSkillFile(content, { maxBodyChars: this.config.skillsMaxBodyChars });
    } catch (err) {
      throw new BadRequestException(
        `invalid skill: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
    return content;
  }

  /**
   * Light first-pass content scan (NOT a sandbox): reject control bytes
   * and a small denylist of obviously destructive patterns. The loader's
   * parser is the authoritative structural validation.
   */
  private scanSkillContent(body: string): void {
    for (const character of body) {
      const code = character.charCodeAt(0);
      if (code < 0x20 && code !== 0x09 && code !== 0x0a) {
        throw new BadRequestException('skill body contains control characters');
      }
    }
    const denylist: readonly RegExp[] = [
      /\brm\s+-rf\s+\/(?:\s|$)/i,
      /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, // fork bomb
      /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sh|bash|zsh)\b/i,
    ];
    for (const pattern of denylist) {
      if (pattern.test(body)) {
        throw new BadRequestException(
          'skill body rejected by the security scan',
        );
      }
    }
  }

  /** Refresh the catalog and require the named skill now loads. */
  private async reloadAndRequire(name: string): Promise<SkillDescriptor> {
    await this.refresh();
    const descriptor = this.descriptors.get(name.toLowerCase());
    if (!descriptor) {
      throw new BadRequestException(`Skill "${name}" did not load after write`);
    }
    return descriptor;
  }

  /** Alphabetical descriptors — no body reads, safe for discovery/catalog. */
  listDescriptors(): SkillDescriptor[] {
    return [...this.descriptors.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  /** Deterministic discovery over descriptors (M7b). Pure ranking —
   * no state mutation, no body reads, no LLM. Empty when disabled. */
  discover(input: string, limit?: number): SkillMatch[] {
    if (!this.enabled) return [];
    return discoverSkills(this.listDescriptors(), input, limit);
  }

  /** Explicit body load from the canonical location, cached per scan
   * generation. Unknown names → 404; disabled catalog → 400. */
  async loadBody(name: string): Promise<LoadedSkill> {
    if (!this.enabled) {
      throw new BadRequestException(
        'Skills are disabled (SKILLS_ENABLED=false).',
      );
    }
    const key = name.toLowerCase();
    const descriptor = this.descriptors.get(key);
    if (!descriptor) {
      throw new NotFoundException(`Unknown skill "${name}"`);
    }
    const cached = this.bodies.get(key);
    if (cached) return cached;
    let parsed: ParsedSkillFile;
    try {
      parsed = await loadSkillBody(
        this.config.skillsDirPath,
        descriptor.path ?? descriptor.name,
        {
          maxBodyChars: this.config.skillsMaxBodyChars,
        },
      );
    } catch {
      // File changed or vanished since the scan: evict rather than serve
      // stale or invalid content.
      this.descriptors.delete(key);
      throw new NotFoundException(`Skill "${name}" is unavailable`);
    }
    const loaded: LoadedSkill = {
      name: parsed.name,
      description: parsed.description,
      version: parsed.version,
      body: parsed.body,
      bodyChars: parsed.body.length,
    };
    this.bodies.set(key, loaded);
    return loaded;
  }

  /**
   * Resolve a canonical registry name without loading the body.
   * Unknown names → 404; disabled catalog → 400.
   */
  resolveName(name: string): SkillDescriptor {
    if (!this.enabled) {
      throw new BadRequestException(
        'Skills are disabled (SKILLS_ENABLED=false).',
      );
    }
    const descriptor = this.descriptors.get(name.toLowerCase());
    if (!descriptor) {
      throw new NotFoundException(`Unknown skill "${name}"`);
    }
    return descriptor;
  }

  /**
   * M18.x: turn skills on/off for one session (context-window pressure). Off
   * means no catalog block, no auto-discovery, and no pinned/one-shot
   * injection for that session — the global kill-switch (`SKILLS_ENABLED`)
   * still wins. Returns the resulting state.
   */
  setSessionSkillsEnabled(sessionId: string, enabled: boolean): boolean {
    if (enabled) {
      this.sessionDisabled.delete(sessionId);
    } else {
      this.sessionDisabled.add(sessionId);
    }
    return this.isSessionSkillsEnabled(sessionId);
  }

  /** Whether skills are active for this session (default true). */
  isSessionSkillsEnabled(sessionId: string): boolean {
    return this.enabled && !this.sessionDisabled.has(sessionId);
  }

  /** Pin a skill for the session until dropped. Idempotent. */
  useSkill(sessionId: string, name: string): string {
    const descriptor = this.resolveName(name);
    let set = this.explicit.get(sessionId);
    if (!set) {
      set = new Set();
      this.explicit.set(sessionId, set);
    }
    if (
      !set.has(descriptor.name) &&
      set.size >= this.config.skillsMaxActivePerSession
    ) {
      throw new BadRequestException(
        `Session already pins ${String(this.config.skillsMaxActivePerSession)} skills (cap SKILLS_MAX_ACTIVE_PER_SESSION). Drop one with /skills drop first.`,
      );
    }
    set.add(descriptor.name);
    return descriptor.name;
  }

  /** Unpin a skill. Unknown-but-valid names report cleanly either way. */
  dropSkill(sessionId: string, name: string): string {
    const descriptor = this.resolveName(name);
    this.explicit.get(sessionId)?.delete(descriptor.name);
    return descriptor.name;
  }

  /** Pinned canonical names for the session (alphabetical). */
  getExplicitNames(sessionId: string): string[] {
    return [...(this.explicit.get(sessionId) ?? [])].sort((a, b) =>
      a.localeCompare(b),
    );
  }

  /**
   * Stage a one-shot explicit request, consumed by the next turn only.
   * Fails fast when the body alone cannot fit the turn budget alongside
   * currently pinned skills — never silently dropped at pull time.
   */
  async stageOneShot(sessionId: string, name: string): Promise<string> {
    const descriptor = this.resolveName(name);
    const requested = await this.loadBody(descriptor.name);
    const explicitChars = await this.pinnedBodyChars(sessionId);
    if (
      explicitChars + requested.bodyChars >
      this.config.skillsMaxContextChars
    ) {
      throw new BadRequestException(
        `Skill "${descriptor.name}" (${requested.bodyChars} chars) does not fit the turn budget (${String(this.config.skillsMaxContextChars)} chars) alongside pinned skills.`,
      );
    }
    let set = this.pending.get(sessionId);
    if (!set) {
      set = new Set();
      this.pending.set(sessionId, set);
    }
    set.add(descriptor.name);
    return descriptor.name;
  }

  /** Sum of pinned body chars (loads through the cache; rotten files are
   * pruned from the pin set rather than failing the turn). */
  private async pinnedBodyChars(sessionId: string): Promise<number> {
    let total = 0;
    for (const name of this.getExplicitNames(sessionId)) {
      try {
        total += (await this.loadBody(name)).bodyChars;
      } catch {
        this.explicit.get(sessionId)?.delete(name);
      }
    }
    return total;
  }

  /** Copy pinned skills on session fork. Pending one-shots and last-turn
   * reports are turn-scoped by definition and are never copied. */
  copyExplicitPins(sourceSessionId: string, forkSessionId: string): void {
    const source = this.explicit.get(sourceSessionId);
    if (source && source.size > 0) {
      this.explicit.set(forkSessionId, new Set(source));
    }
  }

  /** Staged one-shot names awaiting the next turn (alphabetical). */
  getPendingNames(sessionId: string): string[] {
    return [...(this.pending.get(sessionId) ?? [])].sort((a, b) =>
      a.localeCompare(b),
    );
  }

  /** Last completed turn's injection record, if any. */
  getLastTurn(sessionId: string): TurnSkillReport | null {
    return this.lastTurn.get(sessionId) ?? null;
  }

  /** Catalog block for model context: names + descriptions only, bounded.
   * Empty string when disabled or the catalog is empty (callers then emit
   * byte-identical pre-M7 context). */
  buildCatalogBlock(sessionId?: string): string {
    if (!this.enabled) return '';
    if (sessionId && !this.isSessionSkillsEnabled(sessionId)) return '';
    const catalog = this.listDescriptors().slice(
      0,
      this.config.skillsMaxCatalogItems,
    );
    if (catalog.length === 0) return '';
    const lines = ['<available_skills>'];
    for (const skill of catalog) {
      lines.push(`- ${skill.name}: ${skill.description}`);
    }
    const overflow = this.descriptors.size - catalog.length;
    if (overflow > 0) {
      lines.push(`(and ${String(overflow)} more — see /skills)`);
    }
    lines.push(
      'To follow a procedure, the user may activate it with /skills use <name> or request it once with /skills pull <name>.',
      'Relevant skills may also load automatically for the current turn.',
      '</available_skills>',
    );
    return lines.join('\n');
  }

  /**
   * Resolve this turn's skill bodies: pinned explicit skills, staged
   * one-shots (consumed whether or not they fit), then budgeted
   * auto-discovery excluding already-included names. Per-skill load
   * failures prune that skill for the turn instead of failing it —
   * a rotted file must never 500 a conversation.
   */
  async resolveTurnSkills(
    sessionId: string,
    input: string,
  ): Promise<ResolvedTurnSkills> {
    const empty: ResolvedTurnSkills = {
      explicit: [],
      requested: [],
      contextual: [],
      considered: [],
    };
    if (!this.isSessionSkillsEnabled(sessionId)) return empty;
    const maxChars = this.config.skillsMaxContextChars;
    let used = 0;

    const explicit: LoadedSkill[] = [];
    const pruned = new Set<string>();
    for (const name of this.getExplicitNames(sessionId)) {
      try {
        const loaded = await this.loadBody(name);
        explicit.push(loaded);
        used += loaded.bodyChars;
      } catch {
        pruned.add(name);
      }
    }
    if (pruned.size > 0) {
      const set = this.explicit.get(sessionId);
      for (const name of pruned) set?.delete(name);
    }

    const admit = async (names: string[]): Promise<LoadedSkill[]> => {
      const admitted: LoadedSkill[] = [];
      for (const name of names) {
        let loaded: LoadedSkill;
        try {
          loaded = await this.loadBody(name);
        } catch {
          continue;
        }
        if (used + loaded.bodyChars > maxChars) continue;
        used += loaded.bodyChars;
        admitted.push(loaded);
      }
      return admitted;
    };

    // One-shots are consumed by this turn unconditionally — staging is a
    // single-turn promise, not a queue.
    const staged = this.getPendingNames(sessionId);
    this.pending.delete(sessionId);
    const requested = await admit(staged);

    const included = new Set([
      ...explicit.map((s) => s.name.toLowerCase()),
      ...requested.map((s) => s.name.toLowerCase()),
    ]);
    const considered = this.discover(input).filter(
      (m) => !included.has(m.skill.name.toLowerCase()),
    );
    const selected = this.selector.select(considered, {
      maxSkills: this.config.skillsMaxAutoLoadedPerTurn,
      maxChars,
    });
    const contextual = await admit(selected.map((s) => s.name));

    return { explicit, requested, contextual, considered };
  }

  /** Record what the last completed turn injected (memory-only). */
  recordLastTurn(report: TurnSkillReport): void {
    this.lastTurn.set(report.sessionId, report);
  }
}

/**
 * Rewrite a SKILL.md body/description while preserving the rest of its
 * frontmatter verbatim. Only top-level `name` and `description` lines are
 * replaced; nested blocks (`metadata:` and its indented children) are kept.
 */
function mergeSkillFile(
  raw: string,
  name: string,
  description: string,
  body: string,
): string {
  const normalized = raw.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0]?.trim() !== '---') {
    throw new BadRequestException('skill file has no frontmatter');
  }
  const closing = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---',
  );
  if (closing < 0) {
    throw new BadRequestException('skill file frontmatter is unterminated');
  }
  const kept = lines
    .slice(1, closing)
    .filter(
      (line) => !/^name\s*:/.test(line) && !/^description\s*:/.test(line),
    );
  return `---\nname: ${name}\ndescription: ${description}\n${kept.join('\n')}\n---\n\n${body}\n`;
}
