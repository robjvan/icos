import { Injectable, Inject, Optional } from '@nestjs/common';
import {
  isForeignToolName,
  splitForeignToolName,
} from '../mcp/mcp-tool-bridge';
import { validateForeignArgs } from '../mcp/mcp-tool-bridge';

export type ToolName = 'session.search' | 'session.rename' | 'channel.send';

/**
 * A validated foreign (MCP) tool call. The `foreign` marker
 * discriminates the arm: namespaced `mcp_<server>_<tool>` names
 * with args validated against the remote schema (never hand
 * validators). Literal arms narrow first; this catches the rest —
 * and the template type keeps it that way (a general `string`
 * would defeat literal narrowing tree-wide).
 */
export type ForeignToolName = `mcp_${string}`;

export interface ForeignToolCall {
  readonly name: ForeignToolName;
  readonly version: 1;
  readonly sessionId: string;
  readonly args: Record<string, unknown>;
  readonly foreign: {
    readonly server: string;
    readonly tool: string;
  };
}

export type ApprovalPolicy = 'none' | 'required';

export interface ToolDescriptor {
  readonly name: string;
  readonly version: 1;
  readonly description: string;
  readonly approval: ApprovalPolicy;
  readonly argsSchema: Readonly<{
    type: 'object';
    additionalProperties: false;
    required: readonly string[];
    properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  }>;
}

export interface SessionSearchArgs {
  readonly query: string;
  readonly limit: number;
}

export interface SessionRenameArgs {
  readonly title: string;
}

export interface ChannelSendArgs {
  readonly channel: 'discord' | 'email';
  readonly target: 'operator' | 'channel' | 'user';
  /** The channel or user id; required unless the target is the operator. */
  readonly id?: string;
  readonly body: string;
}

export type ValidatedToolArgs =
  SessionSearchArgs | SessionRenameArgs | ChannelSendArgs;

export type ValidatedToolRequest = {
  readonly version: 1;
  readonly sessionId: string;
} & (
  | { readonly name: 'session.search'; readonly args: SessionSearchArgs }
  | { readonly name: 'session.rename'; readonly args: SessionRenameArgs }
  | { readonly name: 'channel.send'; readonly args: ChannelSendArgs }
  | Omit<ForeignToolCall, 'version' | 'sessionId'>
);
export interface ToolValidationContext {
  sessionId: string;
  allowedTools: readonly string[];
}

export type ToolValidationFailureCode =
  | 'invalid_input'
  | 'unknown_tool'
  | 'unknown_version'
  | 'unpermitted_tool'
  | 'invalid_session'
  | 'invalid_args';

export interface ToolValidationFailure {
  readonly code: ToolValidationFailureCode;
  readonly message: string;
}

export type ToolValidationResult =
  | { ok: true; request: ValidatedToolRequest }
  | { ok: false; failure: ToolValidationFailure };

/** DI token for the optional foreign (MCP) tool source. */
export const FOREIGN_TOOL_SOURCE = 'FOREIGN_TOOL_SOURCE';

/**
 * A configured-but-unusable foreign server (M13c): known to the
 * catalog, absent from planning. The loop declares these in the
 * planning frame so absence reads as deliberate, never silent.
 */
export interface UnavailableForeignServer {
  readonly server: string;
  readonly state: 'disabled' | 'failed';
  readonly reason?: string;
}

/**
 * Runtime foreign descriptors (bridged MCP tools). The registry
 * owns the name space; the source owns discovery. Optional —
 * without it the registry is exactly the two native tools.
 */
export interface ForeignToolSource {
  listForeign(): readonly {
    readonly name: string;
    readonly description: string;
    readonly approval: ApprovalPolicy;
    readonly argsSchema: ToolDescriptor['argsSchema'];
  }[];
  lookupForeign(name: string):
    | {
        readonly name: string;
        readonly server: string;
        readonly tool: string;
        readonly description: string;
        readonly approval: ApprovalPolicy;
        readonly argsSchema: ToolDescriptor['argsSchema'];
      }
    | undefined;
  /**
   * Known-but-unusable servers (optional seam; absent = none
   * declared). The bridge serves it; test doubles omit it.
   */
  unavailableForeign?(): readonly UnavailableForeignServer[];
}

const DEFAULT_SEARCH_LIMIT = 20;
const MIN_SEARCH_LIMIT = 1;
const MAX_SEARCH_LIMIT = 100;
const MAX_QUERY_LENGTH = 500;
const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 8000;
const MAX_ID_LENGTH = 200;

const NONBLANK_PATTERN = '\\S';

const NONBLANK_TEST = new RegExp(NONBLANK_PATTERN);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepFreeze<T>(value: T): T {
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    return Object.freeze(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    return Object.freeze(value);
  }
  return value;
}

const SEARCH_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: {
      type: 'string',
      pattern: NONBLANK_PATTERN,
      minLength: 1,
      maxLength: MAX_QUERY_LENGTH,
    },
    limit: {
      type: 'integer',
      minimum: MIN_SEARCH_LIMIT,
      maximum: MAX_SEARCH_LIMIT,
      default: DEFAULT_SEARCH_LIMIT,
    },
  },
} as const);

const RENAME_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: {
    title: {
      type: 'string',
      pattern: NONBLANK_PATTERN,
      minLength: 1,
      maxLength: MAX_TITLE_LENGTH,
    },
  },
} as const);

const CHANNEL_SEND_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['channel', 'target', 'body'],
  properties: {
    channel: { type: 'string', enum: ['discord', 'email'] },
    target: { type: 'string', enum: ['operator', 'channel', 'user'] },
    id: {
      type: 'string',
      pattern: NONBLANK_PATTERN,
      minLength: 1,
      maxLength: MAX_ID_LENGTH,
    },
    body: {
      type: 'string',
      pattern: NONBLANK_PATTERN,
      minLength: 1,
      maxLength: MAX_BODY_LENGTH,
    },
  },
} as const);

const DESCRIPTORS: readonly ToolDescriptor[] = Object.freeze([
  Object.freeze({
    name: 'session.search',
    version: 1,
    description:
      'Search the current session transcript. Returns matching messages.',
    approval: 'none',
    argsSchema: SEARCH_SCHEMA,
  }),
  Object.freeze({
    name: 'session.rename',
    version: 1,
    description: 'Rename the current session.',
    // Deliberately approval-free (2026-09-23): retitling the user's own
    // session is benign and reversible. Granular per-tool approval
    // toggles remain future UI work; if that lands, revisit this.
    approval: 'none',
    argsSchema: RENAME_SCHEMA,
  }),
  Object.freeze({
    name: 'channel.send',
    version: 1,
    description:
      'Send a message on a configured channel (Discord or email) to the ' +
      'operator, or to an allowlisted channel or user. Requires approval.',
    approval: 'required',
    argsSchema: CHANNEL_SEND_SCHEMA,
  }),
]);

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function ownValue(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function rejectUnknownFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
): string | undefined {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      return `Unknown field: ${key}`;
    }
  }
  return undefined;
}

function validText(
  raw: unknown,
  label: string,
  maxLength: number,
): ParseResult<string> {
  if (typeof raw !== 'string') {
    return { ok: false, message: `${label} must be a string` };
  }
  if (!NONBLANK_TEST.test(raw)) {
    return { ok: false, message: `${label} must be nonblank` };
  }
  if (Array.from(raw).length > maxLength) {
    return {
      ok: false,
      message: `${label} must be at most ${maxLength} characters`,
    };
  }
  return { ok: true, value: raw.trim() };
}

function validateSearchArgs(
  args: Record<string, unknown>,
): ParseResult<SessionSearchArgs> {
  const unknownField = rejectUnknownFields(args, ['query', 'limit']);
  if (unknownField !== undefined) {
    return { ok: false, message: unknownField };
  }
  const query = validText(ownValue(args, 'query'), 'query', MAX_QUERY_LENGTH);
  if (!query.ok) {
    return query;
  }
  const limit = Object.hasOwn(args, 'limit')
    ? args.limit
    : DEFAULT_SEARCH_LIMIT;
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < MIN_SEARCH_LIMIT ||
    limit > MAX_SEARCH_LIMIT
  ) {
    return {
      ok: false,
      message: `limit must be an integer between ${MIN_SEARCH_LIMIT} and ${MAX_SEARCH_LIMIT}`,
    };
  }
  return { ok: true, value: Object.freeze({ query: query.value, limit }) };
}

function validateRenameArgs(
  args: Record<string, unknown>,
): ParseResult<SessionRenameArgs> {
  const unknownField = rejectUnknownFields(args, ['title']);
  if (unknownField !== undefined) {
    return { ok: false, message: unknownField };
  }
  const title = validText(ownValue(args, 'title'), 'title', MAX_TITLE_LENGTH);
  if (!title.ok) {
    return title;
  }
  return { ok: true, value: Object.freeze({ title: title.value }) };
}

function validateChannelSendArgs(
  args: Record<string, unknown>,
): ParseResult<ChannelSendArgs> {
  const unknownField = rejectUnknownFields(args, [
    'channel',
    'target',
    'id',
    'body',
  ]);
  if (unknownField !== undefined) {
    return { ok: false, message: unknownField };
  }
  const channel = ownValue(args, 'channel');
  if (channel !== 'discord' && channel !== 'email') {
    return { ok: false, message: 'channel must be "discord" or "email"' };
  }
  const target = ownValue(args, 'target');
  if (target !== 'operator' && target !== 'channel' && target !== 'user') {
    return {
      ok: false,
      message: 'target must be "operator", "channel", or "user"',
    };
  }
  const body = validText(ownValue(args, 'body'), 'body', MAX_BODY_LENGTH);
  if (!body.ok) {
    return body;
  }
  let id: string | undefined;
  if (target !== 'operator') {
    const parsedId = validText(ownValue(args, 'id'), 'id', MAX_ID_LENGTH);
    if (!parsedId.ok) {
      return parsedId;
    }
    id = parsedId.value;
  }
  return {
    ok: true,
    value: Object.freeze({
      channel,
      target,
      ...(id !== undefined ? { id } : {}),
      body: body.value,
    }),
  };
}

function fail(
  code: ToolValidationFailureCode,
  message: string,
): ToolValidationResult {
  return { ok: false, failure: { code, message } };
}

@Injectable()
export class ToolRegistry {
  constructor(
    @Optional()
    @Inject(FOREIGN_TOOL_SOURCE)
    private readonly foreign?: ForeignToolSource,
  ) {}

  list(): readonly ToolDescriptor[] {
    const foreign =
      this.foreign?.listForeign().map((descriptor): ToolDescriptor => ({
        name: descriptor.name,
        version: 1,
        description: descriptor.description,
        approval: descriptor.approval,
        argsSchema: descriptor.argsSchema,
      })) ?? [];
    return [...DESCRIPTORS, ...foreign];
  }

  lookup(name: string): ToolDescriptor | undefined {
    return (
      DESCRIPTORS.find((d) => d.name === name) ??
      this.foreignSourceDescriptor(name)
    );
  }

  /**
   * Known-but-unusable foreign servers for the planning frame
   * (M13c). Empty without a source, or when the source omits the
   * seam — absence of the seam reads as nothing to declare.
   */
  unavailableForeign(): readonly UnavailableForeignServer[] {
    return this.foreign?.unavailableForeign?.() ?? [];
  }

  private foreignSourceDescriptor(name: string): ToolDescriptor | undefined {
    const foreign = this.foreign?.lookupForeign(name);
    if (!foreign) return undefined;
    return {
      name: foreign.name,
      version: 1,
      description: foreign.description,
      approval: foreign.approval,
      argsSchema: foreign.argsSchema,
    };
  }

  validate(
    input: unknown,
    context: ToolValidationContext,
  ): ToolValidationResult {
    if (!isPlainObject(input)) {
      return fail('invalid_input', 'tool call must be a plain object');
    }
    const unknownField = rejectUnknownFields(input, [
      'name',
      'version',
      'args',
    ]);
    if (unknownField !== undefined) {
      return fail('invalid_input', unknownField);
    }
    const name = ownValue(input, 'name');
    if (typeof name !== 'string') {
      return fail('unknown_tool', 'tool name must be a string');
    }
    const descriptor = this.lookup(name);
    if (!descriptor) {
      return fail('unknown_tool', `Unknown tool: ${name}`);
    }
    if (ownValue(input, 'version') !== descriptor.version) {
      return fail('unknown_version', 'Unsupported tool version');
    }
    if (!context.allowedTools.includes(descriptor.name)) {
      return fail('unpermitted_tool', `Tool not permitted: ${name}`);
    }
    if (
      typeof context.sessionId !== 'string' ||
      context.sessionId.trim().length === 0
    ) {
      return fail('invalid_session', 'sessionId is required');
    }
    const args = ownValue(input, 'args');
    if (!isPlainObject(args)) {
      return fail('invalid_args', 'args must be a plain object');
    }
    const base = { version: descriptor.version, sessionId: context.sessionId };
    if (descriptor.name === 'session.search') {
      const result = validateSearchArgs(args);
      if (!result.ok) {
        return fail('invalid_args', result.message);
      }
      return {
        ok: true,
        request: Object.freeze({
          name: 'session.search',
          ...base,
          args: result.value,
        }),
      };
    }
    if (descriptor.name === 'session.rename') {
      const result = validateRenameArgs(args);
      if (!result.ok) {
        return fail('invalid_args', result.message);
      }
      return {
        ok: true,
        request: Object.freeze({
          name: 'session.rename',
          ...base,
          args: result.value,
        }),
      };
    }
    if (descriptor.name === 'channel.send') {
      const result = validateChannelSendArgs(args);
      if (!result.ok) {
        return fail('invalid_args', result.message);
      }
      return {
        ok: true,
        request: Object.freeze({
          name: 'channel.send',
          ...base,
          args: result.value,
        }),
      };
    }
    return this.validateForeign(descriptor.name, args, base);
  }

  /**
   * Foreign validation (M13b): the descriptor came from the bridged
   * source (never hand-written), args check against the translated
   * remote schema. Unknown tools fail here — descriptors and
   * validation read the same source, so a mismatch means the set
   * moved mid-turn (fail closed, re-discover).
   */
  private validateForeign(
    name: string,
    args: Record<string, unknown>,
    base: { version: 1; sessionId: string },
  ): ToolValidationResult {
    if (!isForeignToolName(name)) {
      return fail('unknown_tool', `Unknown tool: ${name}`);
    }
    const foreign = this.foreign?.lookupForeign(name);
    if (!foreign) {
      return fail('unknown_tool', `Unknown tool: ${name}`);
    }
    const split = splitForeignToolName(name);
    if (!split || split.server !== foreign.server) {
      return fail('unknown_tool', `Unknown tool: ${name}`);
    }
    const failure = validateForeignArgs(foreign.argsSchema, args);
    if (failure) {
      return fail('invalid_args', failure);
    }
    return {
      ok: true,
      request: Object.freeze({
        name,
        ...base,
        args: Object.freeze({ ...args }),
        foreign: { server: foreign.server, tool: foreign.tool },
      }),
    };
  }
}
