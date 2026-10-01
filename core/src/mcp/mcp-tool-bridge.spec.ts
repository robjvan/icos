import {
  isForeignToolName,
  splitForeignToolName,
  toArgsSchema,
  toNamespacedName,
  validateForeignArgs,
} from './mcp-tool-bridge';

describe('toNamespacedName', () => {
  it('namespaces server and tool deterministically', () => {
    expect(toNamespacedName('files', 'read')).toBe('mcp_files_read');
    expect(toNamespacedName('Bytestash', 'Get Snippet')).toBe(
      'mcp_bytestash_get_snippet',
    );
  });

  it('refuses unsanitizable names instead of guessing', () => {
    expect(toNamespacedName('', 'read')).toBeNull();
    expect(toNamespacedName('files', '')).toBeNull();
    expect(toNamespacedName('../evil', 'read')).toBeNull();
    expect(toNamespacedName('files', 'a'.repeat(65))).toBeNull();
    expect(toNamespacedName('files', 'x; DROP')).toBeNull();
  });
});

describe('isForeignToolName', () => {
  it('matches sanitized names only', () => {
    expect(isForeignToolName('mcp_files_read')).toBe(true);
    expect(isForeignToolName('session.search')).toBe(false);
    expect(isForeignToolName('mcp_')).toBe(false);
    expect(isForeignToolName('mcp_files')).toBe(false);
    expect(isForeignToolName('MCP_FILES_READ')).toBe(false);
  });

  it('splits server from tool at the first separator', () => {
    expect(splitForeignToolName('mcp_bytestash_get_snippet')).toEqual({
      server: 'bytestash',
      tool: 'get_snippet',
    });
    expect(splitForeignToolName('nope')).toBeNull();
  });
});

describe('toArgsSchema', () => {
  it('translates the boring subset', () => {
    expect(
      toArgsSchema({
        type: 'object',
        properties: {
          path: { type: 'string', description: 'file path' },
          limit: { type: 'integer' },
          tags: { type: 'array', items: { type: 'string' } },
          mode: { enum: ['a', 'b'] },
        },
        required: ['path'],
      }),
    ).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['path'],
    });
  });

  it('fails closed on everything outside the subset', () => {
    const hostile = [
      null,
      [],
      'object',
      { type: 'string' },
      { properties: 'nope' },
      { properties: {}, required: ['missing'] },
      { properties: { a: { type: 'object' } } },
      { properties: { a: { $ref: '#/x' } } },
      { properties: { a: { type: 'string', allOf: [] } } },
      { properties: { a: { type: 'string', oneOf: [] } } },
      { properties: { a: { type: 'string', patternProperties: {} } } },
      {
        properties: Object.fromEntries(
          Array.from({ length: 51 }, (_, i) => [`p${i}`, { type: 'string' }]),
        ),
      },
      { properties: { a: { type: 'array' } } },
      { properties: { a: { type: 'mystery' } } },
      { properties: { a: { enum: [] } } },
      { properties: { a: { type: 'string', additionalProperties: true } } },
      {
        properties: {
          a: {
            type: 'object',
            properties: {},
            additionalProperties: { type: 'string' },
          },
        },
      },
    ];
    for (const schema of hostile) {
      expect(toArgsSchema(schema)).toBeNull();
    }
  });

  it('accepts nested additionalProperties:false (the closed-world marker)', () => {
    // Bytestash-shaped: array of closed objects. Found live 2026-10-01:
    // create_snippet hid behind the blanket ban; the ban was wrong.
    const schema = toArgsSchema({
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1 },
        fragments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file_name: { type: 'string' },
              code: { type: 'string' },
            },
            required: ['code'],
            additionalProperties: false,
          },
          minItems: 1,
        },
      },
      required: ['title', 'fragments'],
    });
    expect(schema).not.toBeNull();
    if (!schema) throw new Error('unreachable');
    expect(
      validateForeignArgs(schema, {
        title: 't',
        fragments: [{ code: 'x = 1' }],
      }),
    ).toBeNull();
    expect(
      validateForeignArgs(schema, {
        title: 't',
        fragments: [{ file_name: 'a.py' }],
      }),
    ).toContain('code');
    expect(
      validateForeignArgs(schema, {
        title: 't',
        fragments: [{ code: 'x', bogus: 1 }],
      }),
    ).toContain('bogus');
  });

  it('bounds depth and description size', () => {
    const deep = (n: number): unknown =>
      n === 0
        ? { type: 'string' }
        : { type: 'object', properties: { next: deep(n - 1) } };
    expect(toArgsSchema({ properties: { a: deep(9) } })).toBeNull();
    const capped = toArgsSchema({
      properties: { a: { type: 'string', description: 'x'.repeat(501) } },
    });
    expect(
      (capped?.properties['a'] as { description?: string }).description,
    ).toHaveLength(500);
  });
});

describe('validateForeignArgs', () => {
  const schema = toArgsSchema({
    type: 'object',
    properties: {
      path: { type: 'string' },
      limit: { type: 'integer' },
      ratio: { type: 'number' },
      verbose: { type: 'boolean' },
      tags: { type: 'array', items: { type: 'string' } },
      opts: {
        type: 'object',
        properties: { depth: { type: 'number' } },
        required: ['depth'],
      },
      mode: { enum: ['a', 'b'] },
    },
    required: ['path'],
  });
  if (!schema) throw new Error('fixture schema must translate');

  it('accepts valid args, naming every failure', () => {
    expect(
      validateForeignArgs(schema, {
        path: '/x',
        limit: 3,
        ratio: 1.5,
        verbose: true,
        tags: ['a'],
        opts: { depth: 2 },
        mode: 'a',
      }),
    ).toBeNull();
    expect(validateForeignArgs(schema, {})).toContain('path');
    expect(validateForeignArgs(schema, { path: '/x', bogus: 1 })).toContain(
      'bogus',
    );
    expect(validateForeignArgs(schema, { path: 42 })).toContain('string');
    expect(validateForeignArgs(schema, { path: '/x', limit: 1.5 })).toContain(
      'integer',
    );
    expect(
      validateForeignArgs(schema, { path: '/x', tags: ['a', 1] }),
    ).toContain('tags[1]');
    expect(validateForeignArgs(schema, { path: '/x', opts: {} })).toContain(
      'depth',
    );
    expect(validateForeignArgs(schema, { path: '/x', mode: 'z' })).toContain(
      'allowed value',
    );
  });

  it('treats integers as numbers where declared', () => {
    expect(validateForeignArgs(schema, { path: '/x', ratio: 2 })).toBeNull();
  });
});
