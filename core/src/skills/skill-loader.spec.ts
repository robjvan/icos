import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SKILL_FILE,
  SkillParseError,
  loadSkillBody,
  parseSkillFile,
  scanSkillDir,
} from './skill-loader';
import { discoverSkills } from './skill-discovery';

const OPTS = { maxBodyChars: 12000 };

function skillFile(
  name: string,
  description = 'A test skill.',
  version?: string,
  body = 'Do the thing.',
): string {
  const versionLine = version === undefined ? '' : `version: ${version}\n`;
  return `---\nname: ${name}\ndescription: ${description}\n${versionLine}---\n\n${body}\n`;
}

function reasonOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(SkillParseError);
    return (err as SkillParseError).reason;
  }
  throw new Error('expected SkillParseError');
}

describe('parseSkillFile', () => {
  it('parses a valid skill file', () => {
    expect(
      parseSkillFile(
        skillFile('daily-journal', 'Capture the day.', '0.1.0', 'Ask away.'),
        OPTS,
      ),
    ).toEqual({
      name: 'daily-journal',
      description: 'Capture the day.',
      version: '0.1.0',
      body: 'Ask away.',
    });
  });

  it('defaults a missing version to 0.0.0', () => {
    expect(parseSkillFile(skillFile('a', 'Desc.'), OPTS).version).toBe('0.0.0');
  });

  it('unquotes quoted scalar values', () => {
    const parsed = parseSkillFile(
      '---\nname: a\ndescription: "Quoted desc."\n---\n\nBody.\n',
      OPTS,
    );
    expect(parsed.description).toBe('Quoted desc.');
  });

  it('tolerates CRLF line endings', () => {
    const parsed = parseSkillFile(
      '---\r\nname: a\r\ndescription: Desc.\r\n---\r\n\r\nBody.\r\n',
      OPTS,
    );
    expect(parsed.name).toBe('a');
  });

  it.each([
    [
      'missing opening marker',
      'name: a\ndescription: d\n---\n\nB\n',
      'bad-frontmatter',
    ],
    [
      'missing closing marker',
      '---\nname: a\ndescription: d\n\nB\n',
      'bad-frontmatter',
    ],
    [
      'duplicate key',
      '---\nname: a\nname: b\ndescription: d\n---\n\nB\n',
      'bad-frontmatter',
    ],
    ['uppercase name', skillFile('Bad', 'd'), 'bad-name'],
    ['empty name', skillFile('', 'd'), 'bad-name'],
    ['missing description', '---\nname: a\n---\n\nB\n', 'missing-description'],
    [
      'long description',
      skillFile('a', 'x'.repeat(501)),
      'description-too-long',
    ],
    ['empty body', '---\nname: a\ndescription: d\n---\n', 'empty-body'],
  ])('rejects %s', (_label, raw, reason) => {
    expect(reasonOf(() => parseSkillFile(raw, OPTS))).toBe(reason);
  });

  it('tolerates unknown keys, nested blocks, and stray lines (M18)', () => {
    const parsed = parseSkillFile(
      [
        '---',
        'name: a',
        'description: d',
        'author: Hermes Agent',
        'license: MIT',
        'platforms: [linux, macos]',
        'metadata:',
        '  hermes:',
        '    tags: [Research, Papers]',
        'just some words',
        '- a list item',
        '---',
        '',
        'Body.',
      ].join('\n'),
      OPTS,
    );
    expect(parsed).toMatchObject({ name: 'a', description: 'd' });
    expect(parsed.body).toBe('Body.');
  });

  it('rejects oversize bodies', () => {
    expect(
      reasonOf(() =>
        parseSkillFile(skillFile('a', 'd', undefined, 'x'.repeat(101)), {
          maxBodyChars: 100,
        }),
      ),
    ).toBe('body-too-large');
  });
});

describe('scanSkillDir / loadSkillBody', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-skills-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeSkill(entry: string, contents: string): void {
    mkdirSync(join(dir, entry), { recursive: true });
    writeFileSync(join(dir, entry, SKILL_FILE), contents);
  }

  it('loads valid skills sorted, skipping invalid entries with reasons', async () => {
    writeSkill(
      'daily-journal',
      skillFile('daily-journal', 'Journal.', '0.2.0', 'Ask.'),
    );
    writeSkill('capture-idea', skillFile('capture-idea', 'Capture.'));
    writeSkill('bad-dir', skillFile('other-name', 'Mismatch.'));
    writeSkill('empty-dir', 'not frontmatter at all');
    mkdirSync(join(dir, 'no-file'));
    mkdirSync(join(dir, '.hidden'));
    writeFileSync(
      join(dir, '.hidden', SKILL_FILE),
      skillFile('.hidden', 'Hidden.'),
    );
    writeFileSync(join(dir, 'stray.txt'), 'ignored');

    const result = await scanSkillDir(dir, OPTS);
    expect(result.dir).toBe(dir);
    expect(result.descriptors).toEqual([
      {
        name: 'capture-idea',
        description: 'Capture.',
        version: '0.0.0',
        path: 'capture-idea',
      },
      {
        name: 'daily-journal',
        description: 'Journal.',
        version: '0.2.0',
        path: 'daily-journal',
      },
    ]);
    expect(result.skipped).toEqual([
      { name: 'bad-dir', reason: 'name-mismatch' },
      { name: 'empty-dir', reason: 'bad-frontmatter' },
    ]);
  });

  it('discovers skills nested under category directories (M18)', async () => {
    mkdirSync(join(dir, 'research', 'arxiv'), { recursive: true });
    writeFileSync(
      join(dir, 'research', 'arxiv', SKILL_FILE),
      skillFile('arxiv', 'Papers.'),
    );
    mkdirSync(join(dir, 'apple', 'imessage'), { recursive: true });
    writeFileSync(
      join(dir, 'apple', 'imessage', SKILL_FILE),
      skillFile('imessage', 'Messages.'),
    );

    const result = await scanSkillDir(dir, OPTS);
    expect(result.descriptors).toEqual([
      {
        name: 'imessage',
        description: 'Messages.',
        version: '0.0.0',
        path: 'apple/imessage',
        category: 'apple',
      },
      {
        name: 'arxiv',
        description: 'Papers.',
        version: '0.0.0',
        path: 'research/arxiv',
        category: 'research',
      },
    ]);
  });

  it('returns an empty catalog for a missing directory', async () => {
    const result = await scanSkillDir(join(dir, 'does-not-exist'), OPTS);
    expect(result).toEqual({
      dir: join(dir, 'does-not-exist'),
      descriptors: [],
      skipped: [],
    });
  });

  it('skips symlinked skill directories (never follows them)', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'icos-skills-outside-'));
    try {
      mkdirSync(join(outside, 'evil'), { recursive: true });
      writeFileSync(
        join(outside, 'evil', SKILL_FILE),
        skillFile('evil', 'Escape.'),
      );
      symlinkSync(join(outside, 'evil'), join(dir, 'evil'));
      const result = await scanSkillDir(dir, OPTS);
      expect(result.descriptors).toEqual([]);
      expect(result.skipped).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('loads a body from its canonical location', async () => {
    writeSkill(
      'daily-journal',
      skillFile('daily-journal', 'Journal.', '0.2.0', 'Ask.'),
    );
    const parsed = await loadSkillBody(dir, 'daily-journal', OPTS);
    expect(parsed.body).toBe('Ask.');
  });

  it('rejects bodies whose directory name mismatches', async () => {
    writeSkill('bad-dir', skillFile('other-name', 'Mismatch.'));
    await expect(loadSkillBody(dir, 'bad-dir', OPTS)).rejects.toMatchObject({
      name: 'SkillParseError',
    });
  });

  it.each([
    'icos-v3-stack',
    'persona-anchor',
    'daily-journal',
    'comments-pass',
    'capture-idea',
  ])('ship seed %s parses clean under the validator', (name) => {
    const raw = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '.reference',
        'skills',
        'legacy',
        name,
        SKILL_FILE,
      ),
      'utf8',
    );
    const parsed = parseSkillFile(raw, OPTS);
    expect(parsed.name).toBe(name);
    expect(parsed.body.length).toBeLessThanOrEqual(2000);
  });

  it('loads the real skill collection under its category layout (M18)', async () => {
    const root = join(__dirname, '..', '..', '..', '.reference', 'skills');
    const result = await scanSkillDir(root, { maxBodyChars: 64 * 1024 });
    // The collection ships ~98 skills; almost all should now load.
    expect(result.descriptors.length).toBeGreaterThanOrEqual(90);
    const arxiv = result.descriptors.find((d) => d.name === 'arxiv');
    expect(arxiv).toMatchObject({
      path: 'research/arxiv',
      category: 'research',
    });
    const journal = result.descriptors.find((d) => d.name === 'daily-journal');
    expect(journal?.path).toBe('legacy/daily-journal');
  });

  it('anchors discovery on the real icos-v3-stack seed', () => {
    const seeds = join(
      __dirname,
      '..',
      '..',
      '..',
      '.reference',
      'skills',
      'legacy',
    );
    const descriptors = (
      ['icos-v3-stack', 'daily-journal', 'comments-pass'] as const
    ).map((name) => {
      const parsed = parseSkillFile(
        readFileSync(join(seeds, name, SKILL_FILE), 'utf8'),
        OPTS,
      );
      return {
        name: parsed.name,
        description: parsed.description,
        version: parsed.version,
      };
    });
    const matches = discoverSkills(descriptors, 'working on the ICOS v3 stack');
    expect(matches[0]?.skill.name).toBe('icos-v3-stack');
  });
});
