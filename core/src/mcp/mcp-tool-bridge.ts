import type { ForeignToolName } from '../tools/tool-registry';

/**
 * Foreign tool naming + schema translation (M13b, pure). MCP names
 * are protocol data — never trusted verbatim. Sanitization is
 * lossy by design (collisions across servers stay separated by the
 * server segment); anything unsanitizable hides the tool with a
 * logged reason instead of guessing.
 */

/** `mcp_<server>_<tool>`, lowercase alnum/dash/underscore only. */
export function toNamespacedName(
  server: string,
  tool: string,
): ForeignToolName | null {
  const clean = (part: string): string | null => {
    const normalized = part
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '_');
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalized)) return null;
    if (normalized.length > 64) return null;
    return normalized;
  };
  const cleanServer = clean(server);
  const cleanTool = clean(tool);
  if (!cleanServer || !cleanTool) return null;
  const name = `mcp_${cleanServer}_${cleanTool}`;
  // Belt and suspenders: the composition provably matches, and the
  // guard below re-verifies (zero trust in string concatenation).
  if (!isForeignToolName(name)) return null;
  return name;
}

export function isForeignToolName(name: string): name is ForeignToolName {
  return /^mcp_[a-z0-9][a-z0-9_-]*_[a-z0-9][a-z0-9_-]*$/.test(name);
}

export function splitForeignToolName(name: string): {
  server: string;
  tool: string;
} | null {
  if (!isForeignToolName(name)) return null;
  const rest = name.slice('mcp_'.length);
  const separator = rest.indexOf('_');
  if (separator < 0) return null;
  return {
    server: rest.slice(0, separator),
    tool: rest.slice(separator + 1),
  };
}

const MAX_SCHEMA_PROPS = 50;
const MAX_SCHEMA_DEPTH = 5;
const MAX_STRING_LENGTH = 10000;

interface JsonSchema {
  type?: unknown;
  properties?: unknown;
  required?: unknown;
  items?: unknown;
  enum?: unknown;
  description?: unknown;
  default?: unknown;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface TranslatedSchema {
  type: 'object';
  additionalProperties: false;
  required: readonly string[];
  properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/**
 * Translate an MCP inputSchema into the closed args-schema shape.
 * Only the boring subset passes (object/properties/required with
 * scalar, enum, object, and array nodes, bounded depth and width).
 * Anything else — $ref, allOf/oneOf/anyOf/not, unbounded depth,
 * patternProperties — fails closed (null = tool hidden, never
 * widened). `additionalProperties` defaults to false: the planner
 * is told exactly what the tool takes.
 */
export function toArgsSchema(inputSchema: unknown): TranslatedSchema | null {
  if (!isPlainRecord(inputSchema)) return null;
  const root = inputSchema as JsonSchema;
  if (root.type !== undefined && root.type !== 'object') return null;
  if (root.properties === undefined) return null;
  if (!isPlainRecord(root.properties)) return null;
  const names = Object.keys(root.properties);
  if (names.length > MAX_SCHEMA_PROPS) return null;
  const properties: Record<string, Record<string, unknown>> = {};
  for (const name of names) {
    const translated = translateNode(root.properties[name], 0);
    if (!translated) return null;
    properties[name] = translated;
  }
  let required: string[] = [];
  if (root.required !== undefined) {
    if (
      !Array.isArray(root.required) ||
      root.required.some(
        (item) => typeof item !== 'string' || !names.includes(item),
      )
    ) {
      return null;
    }
    required = [...(root.required as string[])];
  }
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  };
}

function translateNode(
  node: unknown,
  depth: number,
): Record<string, unknown> | null {
  if (!isPlainRecord(node)) return null;
  if (depth > MAX_SCHEMA_DEPTH) return null;
  const schema = node as JsonSchema;
  // Compositional and reference keywords are out of the subset.
  // `additionalProperties` is banned only when it would widen:
  // `false` matches the closed shape emitted anyway (and is the
  // common real-world marker), while `true` or a schema form
  // would silently accept undeclared args.
  for (const banned of [
    '$ref',
    '$defs',
    'definitions',
    'allOf',
    'anyOf',
    'oneOf',
    'not',
    'if',
    'then',
    'else',
    'patternProperties',
  ]) {
    if (node[banned] !== undefined) return null;
  }
  if (
    node['additionalProperties'] !== undefined &&
    node['additionalProperties'] !== false
  ) {
    return null;
  }
  const out: Record<string, unknown> = {};
  switch (schema.type) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
      out['type'] = schema.type;
      break;
    case 'array':
      if (schema.items === undefined) return null;
      {
        const items = translateNode(schema.items, depth + 1);
        if (!items) return null;
        out['type'] = 'array';
        out['items'] = items;
      }
      break;
    case 'object':
      if (schema.properties === undefined) return null;
      if (!isPlainRecord(schema.properties)) return null;
      {
        const names = Object.keys(schema.properties);
        if (names.length > MAX_SCHEMA_PROPS) return null;
        const properties: Record<string, unknown> = {};
        for (const name of names) {
          const translated = translateNode(schema.properties[name], depth + 1);
          if (!translated) return null;
          properties[name] = translated;
        }
        out['type'] = 'object';
        out['properties'] = properties;
        out['additionalProperties'] = false;
        if (schema.required !== undefined) {
          if (
            !Array.isArray(schema.required) ||
            schema.required.some(
              (item) => typeof item !== 'string' || !names.includes(item),
            )
          ) {
            return null;
          }
          out['required'] = [...(schema.required as string[])];
        }
      }
      break;
    case undefined:
      // Typeless nodes pass only with an enum (constrained unknowns).
      if (schema.enum === undefined) return null;
      break;
    default:
      return null;
  }
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) return null;
    const options: unknown[] = schema.enum;
    out['enum'] = [...options];
  }
  if (schema.description !== undefined) {
    if (typeof schema.description !== 'string') return null;
    out['description'] = schema.description.slice(0, 500);
  }
  if (schema.default !== undefined) {
    try {
      const serialized = JSON.stringify(schema.default);
      if (serialized === undefined || serialized.length > MAX_STRING_LENGTH) {
        return null;
      }
      out['default'] = JSON.parse(serialized) as unknown;
    } catch {
      return null;
    }
  }
  return out;
}

/**
 * Validate args against a translated schema (the translator above
 * guarantees only supported keywords reach this function). Numbers
 * accept integers where `number` is declared; enums constrain;
 * `additionalProperties: false` rejects extras. Returns null on
 * success, a message on failure.
 */
export function validateForeignArgs(
  schema: TranslatedSchema,
  args: Record<string, unknown>,
): string | null {
  for (const name of schema.required) {
    if (args[name] === undefined) return `missing required arg "${name}"`;
  }
  for (const name of Object.keys(args)) {
    const node = schema.properties[name];
    if (!node) return `unknown arg "${name}"`;
    const failure = checkNode(node, args[name], name);
    if (failure) return failure;
  }
  return null;
}

function checkNode(
  node: Readonly<Record<string, unknown>>,
  value: unknown,
  path: string,
): string | null {
  const checkEnum =
    node['enum'] !== undefined &&
    Array.isArray(node['enum']) &&
    !(node['enum'] as unknown[]).some((option) => Object.is(option, value));
  if (checkEnum) return `arg "${path}" is not an allowed value`;
  switch (node['type']) {
    case undefined:
      // Typeless enums passed validation above; nothing more to check.
      return null;
    case 'string':
      return typeof value === 'string'
        ? null
        : `arg "${path}" must be a string`;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? null
        : `arg "${path}" must be a number`;
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
        ? null
        : `arg "${path}" must be an integer`;
    case 'boolean':
      return typeof value === 'boolean'
        ? null
        : `arg "${path}" must be a boolean`;
    case 'array': {
      if (!Array.isArray(value)) return `arg "${path}" must be an array`;
      const items = node['items'];
      if (!isPlainRecord(items)) return `arg "${path}" has an invalid schema`;
      for (let index = 0; index < value.length; index++) {
        const failure = checkNode(items, value[index], `${path}[${index}]`);
        if (failure) return failure;
      }
      return null;
    }
    case 'object': {
      if (!isPlainRecord(value)) return `arg "${path}" must be an object`;
      const properties = node['properties'];
      if (!isPlainRecord(properties)) {
        return `arg "${path}" has an invalid schema`;
      }
      const required = Array.isArray(node['required'])
        ? (node['required'] as unknown[])
        : [];
      for (const name of required) {
        if (typeof name === 'string' && value[name] === undefined) {
          return `missing required arg "${path}.${name}"`;
        }
      }
      for (const name of Object.keys(value)) {
        const child = properties[name];
        if (!isPlainRecord(child)) return `unknown arg "${path}.${name}"`;
        const failure = checkNode(child, value[name], `${path}.${name}`);
        if (failure) return failure;
      }
      return null;
    }
    default:
      return `arg "${path}" has an unsupported type`;
  }
}
