import type {
  ToolDescriptor,
  ToolName,
  ToolValidationContext,
  ToolValidationFailure,
  ToolValidationResult,
  ValidatedToolRequest,
} from './tool-registry';
import { ToolRegistry } from './tool-registry';

const SESSION_ID = 'session-1';

const ALL_TOOLS: readonly ToolName[] = [
  'session.search',
  'session.rename',
  'read_file',
  'search_files',
  'write_file',
  'patch',
  'web_search',
  'web_extract',
  'skills_list',
  'skill_view',
  'todo',
  'memory',
  'clarify',
  'vision_analyze',
  'image_generate',
  'terminal',
  'process_start',
  'process_manage',
  'skill_manage',
];

function contextWith(
  allowedTools: readonly string[] = ALL_TOOLS,
  sessionId = SESSION_ID,
): ToolValidationContext {
  return { sessionId, allowedTools };
}

function expectOk(result: ToolValidationResult): ValidatedToolRequest {
  if (!result.ok) {
    throw new Error(
      `expected ok, got ${result.failure.code}: ${result.failure.message}`,
    );
  }
  return result.request;
}

function expectFailure(result: ToolValidationResult): ToolValidationFailure {
  if (result.ok) {
    throw new Error('expected validation failure');
  }
  return result.failure;
}

function searchCall(args: unknown): unknown {
  return { name: 'session.search', version: 1, args };
}

function renameCall(args: unknown): unknown {
  return { name: 'session.rename', version: 1, args };
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('exposes the canonical native tools', () => {
    expect(registry.list().map((d) => d.name)).toEqual([
      'session.search',
      'session.rename',
      'channel.send',
      'read_file',
      'search_files',
      'write_file',
      'patch',
      'web_search',
      'web_extract',
      'skills_list',
      'skill_view',
      'todo',
      'memory',
      'clarify',
      'vision_analyze',
      'image_generate',
      'terminal',
      'process_start',
      'process_manage',
      'skill_manage',
    ]);
    for (const descriptor of registry.list()) {
      expect(descriptor.version).toBe(1);
      expect(descriptor.description.length).toBeGreaterThan(0);
    }
    expect(registry.lookup('session.search')?.approval).toBe('none');
    expect(registry.lookup('session.rename')?.approval).toBe('none');
    expect(registry.lookup('channel.send')?.approval).toBe('required');
    expect(registry.lookup('read_file')?.approval).toBe('none');
    expect(registry.lookup('search_files')?.approval).toBe('none');
    expect(registry.lookup('write_file')?.approval).toBe('none');
    expect(registry.lookup('patch')?.approval).toBe('none');
    expect(registry.lookup('web_search')?.approval).toBe('none');
    expect(registry.lookup('web_extract')?.approval).toBe('none');
    expect(registry.lookup('skills_list')?.approval).toBe('none');
    expect(registry.lookup('skill_view')?.approval).toBe('none');
    expect(registry.lookup('todo')?.approval).toBe('none');
    expect(registry.lookup('memory')?.approval).toBe('none');
    expect(registry.lookup('clarify')?.approval).toBe('none');
    expect(registry.lookup('vision_analyze')?.approval).toBe('none');
    expect(registry.lookup('image_generate')?.approval).toBe('none');
    expect(registry.lookup('terminal')?.approval).toBe('required');
    expect(registry.lookup('process_start')?.approval).toBe('required');
    expect(registry.lookup('process_manage')?.approval).toBe('none');
    expect(registry.lookup('skill_manage')?.approval).toBe('none');
  });

  it('freezes descriptor metadata against mutation', () => {
    for (const descriptor of registry.list()) {
      expect(Object.isFrozen(descriptor)).toBe(true);
      expect(Object.isFrozen(descriptor.argsSchema)).toBe(true);
      expect(Object.isFrozen(descriptor.argsSchema.properties)).toBe(true);
      expect(Object.isFrozen(descriptor.argsSchema.required)).toBe(true);
      for (const schema of Object.values(descriptor.argsSchema.properties)) {
        expect(Object.isFrozen(schema)).toBe(true);
      }
    }
  });

  it('declares strict flat schemas matching trim and bounds', () => {
    const search = registry.lookup('session.search') as ToolDescriptor;
    expect(search.argsSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['query'],
    });
    expect(search.argsSchema.properties.query).toMatchObject({
      type: 'string',
      pattern: '\\S',
      minLength: 1,
      maxLength: 500,
    });
    expect(search.argsSchema.properties.limit).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 20,
    });
    const rename = registry.lookup('session.rename') as ToolDescriptor;
    expect(rename.argsSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['title'],
    });
    expect(rename.argsSchema.properties.title).toMatchObject({
      type: 'string',
      pattern: '\\S',
      minLength: 1,
      maxLength: 200,
    });
  });

  it('returns undefined for unknown tool lookup', () => {
    expect(registry.lookup('session.delete')).toBeUndefined();
    expect(registry.lookup('')).toBeUndefined();
  });

  describe('validate', () => {
    it('accepts a canonical search call, trimming query and defaulting limit', () => {
      const request = expectOk(
        registry.validate(
          {
            name: 'session.search',
            version: 1,
            args: { query: '  teal rings  ' },
          },
          contextWith(),
        ),
      );
      expect(request).toEqual({
        name: 'session.search',
        version: 1,
        sessionId: SESSION_ID,
        args: { query: 'teal rings', limit: 20 },
      });
    });

    it('accepts explicit limit bounds', () => {
      const upper = expectOk(
        registry.validate(
          searchCall({ query: 'q', limit: 100 }),
          contextWith(),
        ),
      );
      expect(upper.args).toEqual({ query: 'q', limit: 100 });
      const lower = expectOk(
        registry.validate(searchCall({ query: 'q', limit: 1 }), contextWith()),
      );
      expect(lower.args).toEqual({ query: 'q', limit: 1 });
    });

    it('accepts a canonical rename call, trimming the title', () => {
      const request = expectOk(
        registry.validate(
          {
            name: 'session.rename',
            version: 1,
            args: { title: '  Ward map  ' },
          },
          contextWith(),
        ),
      );
      expect(request).toEqual({
        name: 'session.rename',
        version: 1,
        sessionId: SESSION_ID,
        args: { title: 'Ward map' },
      });
    });

    it('accepts 500-char query and 200-char title boundaries', () => {
      const search = expectOk(
        registry.validate(
          searchCall({ query: 'a'.repeat(500) }),
          contextWith(),
        ),
      );
      expect(search.args).toEqual({ query: 'a'.repeat(500), limit: 20 });
      const rename = expectOk(
        registry.validate(
          renameCall({ title: 'b'.repeat(200) }),
          contextWith(),
        ),
      );
      expect(rename.args).toEqual({ title: 'b'.repeat(200) });
    });

    it.each([
      ['session.search', 'query', 500],
      ['session.rename', 'title', 200],
    ] as const)(
      'matches %s schema text constraints before trimming',
      (name, field, max) => {
        const schema = registry.lookup(name)!.argsSchema.properties[field];
        const pattern = new RegExp(schema.pattern as string);
        for (const raw of [
          '',
          ' ',
          '\t\n',
          '\u00a0',
          '\ufeff',
          'a',
          '\u200b',
          'a'.repeat(max),
          'a'.repeat(max + 1),
          ` ${'a'.repeat(max - 2)} `,
          ` ${'a'.repeat(max - 1)} `,
          '\u{1d400}'.repeat(max),
          '\u{1d400}'.repeat(max + 1),
        ]) {
          const length = Array.from(raw).length;
          const expected =
            pattern.test(raw) &&
            length >= (schema.minLength as number) &&
            length <= (schema.maxLength as number);
          const result = registry.validate(
            { name, version: 1, args: { [field]: raw } },
            contextWith(),
          );
          expect(result.ok).toBe(expected);
          if (result.ok) {
            expect(result.request.args).toEqual(
              name === 'session.search'
                ? { query: raw.trim(), limit: 20 }
                : { title: raw.trim() },
            );
          } else {
            expect(result.failure.code).toBe('invalid_args');
          }
        }
      },
    );

    it('rejects whitespace-only strings via pattern', () => {
      for (const blank of [
        '',
        ' ',
        '\t',
        '\n',
        '\u00a0',
        '\u2028',
        '\u3000',
        '\ufeff',
      ]) {
        expect(
          expectFailure(
            registry.validate(searchCall({ query: blank }), contextWith()),
          ).code,
        ).toBe('invalid_args');
        expect(
          expectFailure(
            registry.validate(renameCall({ title: blank }), contextWith()),
          ).code,
        ).toBe('invalid_args');
      }
    });

    it('returns frozen canonical copies decoupled from caller input', () => {
      const input: { args: { query: string } } = {
        args: { query: 'original' },
      };
      const call = { name: 'session.search', version: 1, args: input.args };
      const request = expectOk(registry.validate(call, contextWith()));
      input.args.query = 'MUTATED';
      expect(request.args).toEqual({ query: 'original', limit: 20 });
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(request.args)).toBe(true);
      expect('approved' in request).toBe(false);
    });

    it('fails unknown tools', () => {
      expect(
        expectFailure(
          registry.validate(
            { name: 'session.delete', version: 1, args: {} },
            contextWith(),
          ),
        ).code,
      ).toBe('unknown_tool');
      expect(
        expectFailure(
          registry.validate({ name: 42, version: 1, args: {} }, contextWith()),
        ).code,
      ).toBe('unknown_tool');
    });

    it('fails tools outside the explicitly allowed names', () => {
      const failure = expectFailure(
        registry.validate(
          { name: 'session.rename', version: 1, args: { title: 'x' } },
          contextWith(['session.search']),
        ),
      );
      expect(failure.code).toBe('unpermitted_tool');
    });

    it('fails unknown or missing versions, including JSON-invalid values', () => {
      const badVersions: unknown[] = [
        2,
        0,
        -1,
        1.5,
        '1',
        'one',
        null,
        true,
        [1],
        { version: 1 },
        { toString: null },
        { toString: '1' },
        { toString: { value: 1 } },
      ];
      for (const version of badVersions) {
        expect(
          expectFailure(
            registry.validate(
              JSON.parse(
                JSON.stringify({
                  name: 'session.search',
                  version,
                  args: { query: 'q' },
                }),
              ),
              contextWith(),
            ),
          ),
        ).toEqual({
          code: 'unknown_version',
          message: 'Unsupported tool version',
        });
      }
      for (const version of [undefined, NaN, Infinity, -Infinity]) {
        expect(
          expectFailure(
            registry.validate(
              { name: 'session.search', version, args: { query: 'q' } },
              contextWith(),
            ),
          ).code,
        ).toBe('unknown_version');
      }
      expect(
        expectFailure(
          registry.validate(
            { name: 'session.search', args: { query: 'q' } },
            contextWith(),
          ),
        ).code,
      ).toBe('unknown_version');
    });

    it('fails extra top-level fields, including smuggled session targets', () => {
      expect(
        expectFailure(
          registry.validate(
            {
              name: 'session.search',
              version: 1,
              args: { query: 'q' },
              sessionId: 'other-session',
            },
            contextWith(),
          ),
        ).code,
      ).toBe('invalid_input');
      expect(
        expectFailure(
          registry.validate(
            {
              name: 'session.search',
              version: 1,
              args: { query: 'q' },
              approved: true,
            },
            contextWith(),
          ),
        ).code,
      ).toBe('invalid_input');
    });

    it('fails non-object input and non-object args', () => {
      for (const bad of [null, 'x', 42, true, []]) {
        expect(expectFailure(registry.validate(bad, contextWith())).code).toBe(
          'invalid_input',
        );
      }
      for (const badArgs of [null, 'x', 42, []]) {
        expect(
          expectFailure(registry.validate(searchCall(badArgs), contextWith()))
            .code,
        ).toBe('invalid_args');
      }
      expect(
        expectFailure(
          registry.validate(
            { name: 'session.search', version: 1 },
            contextWith(),
          ),
        ).code,
      ).toBe('invalid_args');
    });

    it('narrows canonical argument types by tool name', () => {
      for (const input of [
        searchCall({ query: 'q' }),
        renameCall({ title: 't' }),
      ]) {
        const request = expectOk(registry.validate(input, contextWith()));
        if (request.name === 'session.search') {
          const query: string = request.args.query;
          const limit: number = request.args.limit;
          const hasTitle: 'title' extends keyof typeof request.args
            ? true
            : false = false;
          expect([query, limit, hasTitle]).toEqual(['q', 20, false]);
        } else if (request.name === 'session.rename') {
          const title: string = request.args.title;
          const hasQuery: 'query' extends keyof typeof request.args
            ? true
            : false = false;
          expect([title, hasQuery]).toEqual(['t', false]);
        } else {
          throw new Error('native calls never validate foreign');
        }
      }
    });

    it('fails inherited or non-plain objects for the tool call', () => {
      class Fake {
        name = 'session.search';
        version = 1;
        args = { query: 'q' };
      }
      expect(
        expectFailure(registry.validate(new Fake(), contextWith())).code,
      ).toBe('invalid_input');
      const canonical = {
        name: 'session.search',
        version: 1,
        args: { query: 'q' },
      };
      for (const key of ['name', 'version', 'args'] as const) {
        const inherited = Object.create({ [key]: canonical[key] }) as Record<
          string,
          unknown
        >;
        Object.assign(inherited, canonical);
        delete inherited[key];
        expect(
          expectFailure(registry.validate(inherited, contextWith())).code,
        ).toBe('invalid_input');
      }
      const inheritedExtra = Object.assign(
        Object.create({ extra: true }) as Record<string, unknown>,
        canonical,
      );
      expect(
        expectFailure(registry.validate(inheritedExtra, contextWith())).code,
      ).toBe('invalid_input');
    });

    it('rejects inherited arguments and non-plain argument containers', () => {
      class SearchArgs {
        query = 'q';
      }
      class RenameArgs {
        title = 't';
      }
      const inheritedLimit = Object.assign(
        Object.create({ limit: 99 }) as Record<string, unknown>,
        { query: 'q' },
      );
      for (const input of [
        searchCall(Object.create({ query: 'q' })),
        searchCall(inheritedLimit),
        renameCall(Object.create({ title: 't' })),
        searchCall(new SearchArgs()),
        renameCall(new RenameArgs()),
        searchCall(new Date()),
        renameCall(new Map()),
      ]) {
        expect(
          expectFailure(registry.validate(input, contextWith())).code,
        ).toBe('invalid_args');
      }
    });

    it('accepts own fields on null-prototype records', () => {
      for (const args of [{ query: 'q' }, { title: 't' }]) {
        const input = Object.assign(
          Object.create(null) as Record<string, unknown>,
          {
            name: 'query' in args ? 'session.search' : 'session.rename',
            version: 1,
            args: Object.assign(
              Object.create(null) as Record<string, unknown>,
              args,
            ),
          },
        );
        expectOk(registry.validate(input, contextWith()));
      }
    });

    it('fails invalid search queries', () => {
      const cases: unknown[] = [
        {},
        { query: '   ' },
        { query: 42 },
        { query: null },
        { query: ['q'] },
        { query: { toString: () => 'q' } },
        { query: 'a'.repeat(501) },
        { query: 'q', sessionId: 'other' },
      ];
      for (const bad of cases) {
        expect(
          expectFailure(registry.validate(searchCall(bad), contextWith())).code,
        ).toBe('invalid_args');
      }
    });

    it('fails invalid search limits', () => {
      const cases: unknown[] = [
        { query: 'q', limit: 0 },
        { query: 'q', limit: 101 },
        { query: 'q', limit: 1.5 },
        { query: 'q', limit: '20' },
        { query: 'q', limit: null },
        { query: 'q', limit: true },
        { query: 'q', limit: undefined },
        { query: 'q', limit: Number.NaN },
        { query: 'q', limit: Number.POSITIVE_INFINITY },
      ];
      for (const bad of cases) {
        expect(
          expectFailure(registry.validate(searchCall(bad), contextWith())).code,
        ).toBe('invalid_args');
      }
    });

    it('fails invalid rename titles', () => {
      const cases: unknown[] = [
        {},
        { title: '   ' },
        { title: 7 },
        { title: ['t'] },
        { title: { toString: () => 't' } },
        { title: 'b'.repeat(201) },
        { title: 'x', approved: true },
        { title: 'x', limit: 5 },
      ];
      for (const bad of cases) {
        expect(
          expectFailure(registry.validate(renameCall(bad), contextWith())).code,
        ).toBe('invalid_args');
      }
    });

    it('fails when the trusted sessionId is missing or blank', () => {
      expect(
        expectFailure(
          registry.validate(
            searchCall({ query: 'q' }),
            contextWith(ALL_TOOLS, ''),
          ),
        ).code,
      ).toBe('invalid_session');
      expect(
        expectFailure(
          registry.validate(
            searchCall({ query: 'q' }),
            contextWith(ALL_TOOLS, '   '),
          ),
        ).code,
      ).toBe('invalid_session');
    });
  });

  describe('file tools (M17b)', () => {
    it('accepts read_file and search_files with bounded args', () => {
      const read = expectOk(
        registry.validate(
          {
            name: 'read_file',
            version: 1,
            args: { path: 'notes/a.md', maxBytes: 100 },
          },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(read).toMatchObject({
        name: 'read_file',
        args: { path: 'notes/a.md', maxBytes: 100 },
      });

      const search = expectOk(
        registry.validate(
          {
            name: 'search_files',
            version: 1,
            args: { query: 'TODO', path: 'src', maxResults: 5 },
          },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(search).toMatchObject({
        name: 'search_files',
        args: { query: 'TODO', path: 'src', maxResults: 5 },
      });
    });

    it('rejects blank paths, unknown fields, and out-of-range bounds', () => {
      const cases: unknown[] = [
        { name: 'read_file', version: 1, args: { path: '   ' } },
        {
          name: 'read_file',
          version: 1,
          args: { path: 'a', maxBytes: 99_999_999 },
        },
        { name: 'read_file', version: 1, args: { path: 'a', extra: 1 } },
        {
          name: 'search_files',
          version: 1,
          args: { query: 'x', maxResults: 999 },
        },
        { name: 'search_files', version: 1, args: { query: '' } },
      ];
      for (const call of cases) {
        expect(
          expectFailure(registry.validate(call, contextWith(ALL_TOOLS))).code,
        ).toBe('invalid_args');
      }
    });

    it('accepts write_file and patch, and rejects bad shapes', () => {
      const write = expectOk(
        registry.validate(
          {
            name: 'write_file',
            version: 1,
            args: { path: 'a.txt', content: 'hi' },
          },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(write).toMatchObject({
        name: 'write_file',
        args: { path: 'a.txt', content: 'hi' },
      });

      const patch = expectOk(
        registry.validate(
          {
            name: 'patch',
            version: 1,
            args: {
              path: 'a.txt',
              oldString: 'hi',
              newString: 'bye',
              replaceAll: true,
            },
          },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(patch).toMatchObject({
        name: 'patch',
        args: { oldString: 'hi', newString: 'bye', replaceAll: true },
      });

      const bad: unknown[] = [
        { name: 'write_file', version: 1, args: { path: 'a', content: 1 } },
        { name: 'write_file', version: 1, args: { path: '  ', content: 'x' } },
        {
          name: 'patch',
          version: 1,
          args: { path: 'a', oldString: '', newString: 'x' },
        },
        {
          name: 'patch',
          version: 1,
          args: {
            path: 'a',
            oldString: 'x',
            newString: 'y',
            replaceAll: 'yes',
          },
        },
      ];
      for (const call of bad) {
        expect(
          expectFailure(registry.validate(call, contextWith(ALL_TOOLS))).code,
        ).toBe('invalid_args');
      }
    });
  });

  describe('web tools (M17b)', () => {
    it('accepts web_search and web_extract, and rejects bad shapes', () => {
      const search = expectOk(
        registry.validate(
          {
            name: 'web_search',
            version: 1,
            args: { query: 'searxng', maxResults: 3 },
          },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(search).toMatchObject({
        name: 'web_search',
        args: { query: 'searxng', maxResults: 3 },
      });

      const extract = expectOk(
        registry.validate(
          {
            name: 'web_extract',
            version: 1,
            args: { url: 'https://example.com' },
          },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(extract).toMatchObject({
        name: 'web_extract',
        args: { url: 'https://example.com' },
      });

      const bad: unknown[] = [
        { name: 'web_search', version: 1, args: { query: '' } },
        {
          name: 'web_search',
          version: 1,
          args: { query: 'x', maxResults: 999 },
        },
        { name: 'web_extract', version: 1, args: { url: '   ' } },
        { name: 'web_extract', version: 1, args: { url: 'x', extra: 1 } },
      ];
      for (const call of bad) {
        expect(
          expectFailure(registry.validate(call, contextWith(ALL_TOOLS))).code,
        ).toBe('invalid_args');
      }
    });
  });

  describe('skill tools (M17b)', () => {
    it('accepts skills_list and skill_view, and rejects bad shapes', () => {
      const list = expectOk(
        registry.validate(
          { name: 'skills_list', version: 1, args: {} },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(list).toMatchObject({ name: 'skills_list' });

      const view = expectOk(
        registry.validate(
          {
            name: 'skill_view',
            version: 1,
            args: { name: 'icos-v3-stack' },
          },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(view).toMatchObject({
        name: 'skill_view',
        args: { name: 'icos-v3-stack' },
      });

      const bad: unknown[] = [
        { name: 'skills_list', version: 1, args: { extra: 1 } },
        { name: 'skill_view', version: 1, args: { name: '   ' } },
        { name: 'skill_view', version: 1, args: {} },
      ];
      for (const call of bad) {
        expect(
          expectFailure(registry.validate(call, contextWith(ALL_TOOLS))).code,
        ).toBe('invalid_args');
      }
    });
  });

  describe('todo tool (M17b)', () => {
    it('accepts each action and rejects bad shapes', () => {
      const list = expectOk(
        registry.validate(
          { name: 'todo', version: 1, args: { action: 'list' } },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(list).toMatchObject({ name: 'todo', args: { action: 'list' } });

      const add = expectOk(
        registry.validate(
          { name: 'todo', version: 1, args: { action: 'add', text: 'do it' } },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(add).toMatchObject({
        name: 'todo',
        args: { action: 'add', text: 'do it' },
      });

      const complete = expectOk(
        registry.validate(
          { name: 'todo', version: 1, args: { action: 'complete', id: 't1' } },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(complete).toMatchObject({
        name: 'todo',
        args: { action: 'complete', id: 't1' },
      });

      const bad: unknown[] = [
        { name: 'todo', version: 1, args: { action: 'add' } },
        { name: 'todo', version: 1, args: { action: 'add', text: '   ' } },
        { name: 'todo', version: 1, args: { action: 'complete' } },
        { name: 'todo', version: 1, args: { action: 'nope' } },
        { name: 'todo', version: 1, args: { action: 'list', extra: 1 } },
      ];
      for (const call of bad) {
        expect(
          expectFailure(registry.validate(call, contextWith(ALL_TOOLS))).code,
        ).toBe('invalid_args');
      }
    });
  });

  describe('memory tool (M17b)', () => {
    it('accepts each layer and rejects bad shapes', () => {
      const beliefs = expectOk(
        registry.validate(
          {
            name: 'memory',
            version: 1,
            args: { layer: 'beliefs', status: 'active' },
          },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(beliefs).toMatchObject({
        name: 'memory',
        args: { layer: 'beliefs', status: 'active' },
      });

      const recall = expectOk(
        registry.validate(
          {
            name: 'memory',
            version: 1,
            args: { layer: 'recall', query: 'sweaters' },
          },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(recall).toMatchObject({
        name: 'memory',
        args: { layer: 'recall', query: 'sweaters' },
      });

      const persona = expectOk(
        registry.validate(
          { name: 'memory', version: 1, args: { layer: 'persona' } },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(persona).toMatchObject({
        name: 'memory',
        args: { layer: 'persona' },
      });

      const candidates = expectOk(
        registry.validate(
          {
            name: 'memory',
            version: 1,
            args: { layer: 'candidates', limit: 5 },
          },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(candidates).toMatchObject({
        name: 'memory',
        args: { layer: 'candidates', limit: 5 },
      });

      const bad: unknown[] = [
        { name: 'memory', version: 1, args: {} },
        { name: 'memory', version: 1, args: { layer: 'nope' } },
        { name: 'memory', version: 1, args: { layer: 'recall' } },
        {
          name: 'memory',
          version: 1,
          args: { layer: 'persona', status: 'active' },
        },
        {
          name: 'memory',
          version: 1,
          args: { layer: 'beliefs', status: 'nope' },
        },
        { name: 'memory', version: 1, args: { layer: 'beliefs', limit: 0 } },
        { name: 'memory', version: 1, args: { layer: 'beliefs', limit: 999 } },
        { name: 'memory', version: 1, args: { layer: 'beliefs', extra: 1 } },
      ];
      for (const call of bad) {
        expect(
          expectFailure(registry.validate(call, contextWith(ALL_TOOLS))).code,
        ).toBe('invalid_args');
      }
    });
  });

  describe('clarify tool (M17b)', () => {
    it('accepts a question with options and rejects bad shapes', () => {
      const plain = expectOk(
        registry.validate(
          { name: 'clarify', version: 1, args: { question: 'Which one?' } },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(plain).toMatchObject({
        name: 'clarify',
        args: { question: 'Which one?' },
      });

      const withOptions = expectOk(
        registry.validate(
          {
            name: 'clarify',
            version: 1,
            args: { question: 'Which one?', options: ['a', 'b'], ttlMs: 60000 },
          },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(withOptions).toMatchObject({
        name: 'clarify',
        args: { question: 'Which one?', options: ['a', 'b'], ttlMs: 60000 },
      });

      const bad: unknown[] = [
        { name: 'clarify', version: 1, args: {} },
        { name: 'clarify', version: 1, args: { question: '   ' } },
        {
          name: 'clarify',
          version: 1,
          args: { question: 'q', options: ['a'] },
        },
        {
          name: 'clarify',
          version: 1,
          args: { question: 'q', options: ['a', ''] },
        },
        {
          name: 'clarify',
          version: 1,
          args: { question: 'q', options: ['a', 'b', 'c', 'd', 'e'] },
        },
        { name: 'clarify', version: 1, args: { question: 'q', ttlMs: 0 } },
        { name: 'clarify', version: 1, args: { question: 'q', extra: 1 } },
      ];
      for (const call of bad) {
        expect(
          expectFailure(registry.validate(call, contextWith(ALL_TOOLS))).code,
        ).toBe('invalid_args');
      }
    });
  });

  describe('vision_analyze tool (M17b.8)', () => {
    it('accepts a path or url and rejects bad shapes', () => {
      const byPath = expectOk(
        registry.validate(
          { name: 'vision_analyze', version: 1, args: { path: 'pic.png' } },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(byPath).toMatchObject({
        name: 'vision_analyze',
        args: { path: 'pic.png' },
      });

      const byUrl = expectOk(
        registry.validate(
          {
            name: 'vision_analyze',
            version: 1,
            args: { url: 'https://x/y.png', prompt: 'What is this?' },
          },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(byUrl).toMatchObject({
        name: 'vision_analyze',
        args: { url: 'https://x/y.png', prompt: 'What is this?' },
      });

      const bad: unknown[] = [
        { name: 'vision_analyze', version: 1, args: {} },
        {
          name: 'vision_analyze',
          version: 1,
          args: { path: 'a.png', url: 'https://x/y.png' },
        },
        { name: 'vision_analyze', version: 1, args: { path: '   ' } },
        {
          name: 'vision_analyze',
          version: 1,
          args: { url: 'https://x/y.png', extra: 1 },
        },
      ];
      for (const call of bad) {
        expect(
          expectFailure(registry.validate(call, contextWith(ALL_TOOLS))).code,
        ).toBe('invalid_args');
      }
    });
  });

  describe('image_generate tool (M17b.9)', () => {
    it('accepts a prompt with an optional size and rejects bad shapes', () => {
      const plain = expectOk(
        registry.validate(
          {
            name: 'image_generate',
            version: 1,
            args: { prompt: 'a teal square' },
          },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(plain).toMatchObject({
        name: 'image_generate',
        args: { prompt: 'a teal square' },
      });

      const sized = expectOk(
        registry.validate(
          {
            name: 'image_generate',
            version: 1,
            args: { prompt: 'a teal square', size: '512x512' },
          },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(sized).toMatchObject({
        name: 'image_generate',
        args: { prompt: 'a teal square', size: '512x512' },
      });

      const bad: unknown[] = [
        { name: 'image_generate', version: 1, args: {} },
        { name: 'image_generate', version: 1, args: { prompt: '   ' } },
        {
          name: 'image_generate',
          version: 1,
          args: { prompt: 'x', size: 'big' },
        },
        {
          name: 'image_generate',
          version: 1,
          args: { prompt: 'x', extra: 1 },
        },
      ];
      for (const call of bad) {
        expect(
          expectFailure(registry.validate(call, contextWith(ALL_TOOLS))).code,
        ).toBe('invalid_args');
      }
    });
  });

  describe('terminal tool (M17c)', () => {
    it('accepts a command with optional cwd/timeout and rejects bad shapes', () => {
      const plain = expectOk(
        registry.validate(
          { name: 'terminal', version: 1, args: { command: 'ls -la' } },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(plain).toMatchObject({
        name: 'terminal',
        args: { command: 'ls -la' },
      });

      const full = expectOk(
        registry.validate(
          {
            name: 'terminal',
            version: 1,
            args: { command: 'ls', cwd: 'notes', timeoutMs: 5000 },
          },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(full).toMatchObject({
        name: 'terminal',
        args: { command: 'ls', cwd: 'notes', timeoutMs: 5000 },
      });

      const bad: unknown[] = [
        { name: 'terminal', version: 1, args: {} },
        { name: 'terminal', version: 1, args: { command: '   ' } },
        { name: 'terminal', version: 1, args: { command: 'ls', timeoutMs: 0 } },
        { name: 'terminal', version: 1, args: { command: 'ls', extra: 1 } },
      ];
      for (const call of bad) {
        expect(
          expectFailure(registry.validate(call, contextWith(ALL_TOOLS))).code,
        ).toBe('invalid_args');
      }
    });
  });

  describe('process tools (M17c.2)', () => {
    it('validates process_start and process_manage', () => {
      const start = expectOk(
        registry.validate(
          {
            name: 'process_start',
            version: 1,
            args: { command: 'sleep 1', cwd: 'notes' },
          },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(start).toMatchObject({
        name: 'process_start',
        args: { command: 'sleep 1', cwd: 'notes' },
      });

      const list = expectOk(
        registry.validate(
          { name: 'process_manage', version: 1, args: { action: 'list' } },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(list).toMatchObject({
        name: 'process_manage',
        args: { action: 'list' },
      });

      const output = expectOk(
        registry.validate(
          {
            name: 'process_manage',
            version: 1,
            args: { action: 'output', id: 'p1' },
          },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(output).toMatchObject({
        name: 'process_manage',
        args: { action: 'output', id: 'p1' },
      });

      const bad: unknown[] = [
        { name: 'process_start', version: 1, args: {} },
        { name: 'process_start', version: 1, args: { command: '   ' } },
        { name: 'process_manage', version: 1, args: {} },
        { name: 'process_manage', version: 1, args: { action: 'output' } },
        { name: 'process_manage', version: 1, args: { action: 'nope' } },
        {
          name: 'process_manage',
          version: 1,
          args: { action: 'list', extra: 1 },
        },
      ];
      for (const call of bad) {
        expect(
          expectFailure(registry.validate(call, contextWith(ALL_TOOLS))).code,
        ).toBe('invalid_args');
      }
    });
  });

  describe('skill_manage tool (M17c.3)', () => {
    it('validates create/update/delete', () => {
      const create = expectOk(
        registry.validate(
          {
            name: 'skill_manage',
            version: 1,
            args: {
              action: 'create',
              name: 'demo',
              description: 'Demo.',
              body: 'Step.',
            },
          },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(create).toMatchObject({
        name: 'skill_manage',
        args: {
          action: 'create',
          name: 'demo',
          description: 'Demo.',
          body: 'Step.',
        },
      });

      const del = expectOk(
        registry.validate(
          {
            name: 'skill_manage',
            version: 1,
            args: { action: 'delete', name: 'demo' },
          },
          contextWith(ALL_TOOLS),
        ),
      );
      expect(del).toMatchObject({
        name: 'skill_manage',
        args: { action: 'delete', name: 'demo' },
      });

      const bad: unknown[] = [
        { name: 'skill_manage', version: 1, args: {} },
        {
          name: 'skill_manage',
          version: 1,
          args: {
            action: 'create',
            name: 'Bad Name',
            description: 'x',
            body: 'y',
          },
        },
        {
          name: 'skill_manage',
          version: 1,
          args: { action: 'create', name: 'demo', body: 'y' },
        },
        {
          name: 'skill_manage',
          version: 1,
          args: { action: 'create', name: 'demo', description: 'x' },
        },
        {
          name: 'skill_manage',
          version: 1,
          args: { action: 'delete', name: 'demo', body: 'y' },
        },
        {
          name: 'skill_manage',
          version: 1,
          args: { action: 'nope', name: 'demo' },
        },
        {
          name: 'skill_manage',
          version: 1,
          args: { action: 'delete', name: 'demo', extra: 1 },
        },
      ];
      for (const call of bad) {
        expect(
          expectFailure(registry.validate(call, contextWith(ALL_TOOLS))).code,
        ).toBe('invalid_args');
      }
    });
  });

  describe('foreign delegation (M13b)', () => {
    const foreignDescriptor = {
      name: 'mcp_files_read',
      server: 'files',
      tool: 'read',
      description: 'Read a file',
      approval: 'required' as const,
      argsSchema: {
        type: 'object' as const,
        additionalProperties: false as const,
        required: ['path'] as readonly string[],
        properties: {
          path: { type: 'string' },
        } as Readonly<Record<string, Readonly<Record<string, unknown>>>>,
      },
    };

    const withForeign = () =>
      new ToolRegistry({
        listForeign: () => [foreignDescriptor],
        lookupForeign: (name: string) =>
          name === foreignDescriptor.name ? foreignDescriptor : undefined,
      });

    const foreignCall = (args: unknown): unknown => ({
      name: 'mcp_files_read',
      version: 1,
      args,
    });

    it('lists and looks up bridged tools alongside natives', () => {
      const bridged = withForeign();
      expect(bridged.list().map((d) => d.name)).toEqual([
        'session.search',
        'session.rename',
        'channel.send',
        'read_file',
        'search_files',
        'write_file',
        'patch',
        'web_search',
        'web_extract',
        'skills_list',
        'skill_view',
        'todo',
        'memory',
        'clarify',
        'vision_analyze',
        'image_generate',
        'terminal',
        'process_start',
        'process_manage',
        'skill_manage',
        'mcp_files_read',
      ]);
      expect(bridged.lookup('mcp_files_read')).toMatchObject({
        approval: 'required',
      });
      expect(bridged.lookup('mcp_nope')).toBeUndefined();
    });

    it('validates foreign args with the foreign marker attached', () => {
      const bridged = withForeign();
      const request = expectOk(
        bridged.validate(
          foreignCall({ path: '/x' }),
          contextWith(['mcp_files_read']),
        ),
      );
      expect(request).toMatchObject({
        name: 'mcp_files_read',
        foreign: { server: 'files', tool: 'read' },
      });
      expect(request.args).toEqual({ path: '/x' });
    });

    it('fails foreign calls closed: missing, unpermitted, invalid', () => {
      const bridged = withForeign();
      // Unknown to the bridge (moved set mid-turn).
      expect(
        expectFailure(
          bridged.validate(
            { name: 'mcp_files_gone', version: 1, args: {} },
            contextWith(['mcp_files_gone']),
          ),
        ).code,
      ).toBe('unknown_tool');
      // Not in the allowed set.
      expect(
        expectFailure(
          bridged.validate(
            foreignCall({ path: '/x' }),
            contextWith(['session.search']),
          ),
        ).code,
      ).toBe('unpermitted_tool');
      // Against the remote schema.
      expect(
        expectFailure(
          bridged.validate(foreignCall({}), contextWith(['mcp_files_read'])),
        ).code,
      ).toBe('invalid_args');
      expect(
        expectFailure(
          bridged.validate(
            foreignCall({ path: '/x', extra: 1 }),
            contextWith(['mcp_files_read']),
          ),
        ).code,
      ).toBe('invalid_args');
    });

    it('stays native-only without a foreign source', () => {
      expect(registry.lookup('mcp_files_read')).toBeUndefined();
      expect(
        expectFailure(
          registry.validate(
            foreignCall({ path: '/x' }),
            contextWith(['mcp_files_read']),
          ),
        ).code,
      ).toBe('unknown_tool');
    });

    it('declares unavailable servers only when the source serves them', () => {
      // No source, no declaration.
      expect(registry.unavailableForeign()).toEqual([]);
      // Source without the seam: nothing to declare.
      expect(withForeign().unavailableForeign()).toEqual([]);
      // Source with the seam: forwarded verbatim.
      const down = [{ server: 'files', state: 'failed' as const }];
      const declaring = new ToolRegistry({
        listForeign: () => [],
        lookupForeign: () => undefined,
        unavailableForeign: () => down,
      });
      expect(declaring.unavailableForeign()).toEqual(down);
    });
  });
});
