import { Injectable, Inject, Optional } from '@nestjs/common';
import {
  isForeignToolName,
  splitForeignToolName,
} from '../mcp/mcp-tool-bridge';
import { validateForeignArgs } from '../mcp/mcp-tool-bridge';

export type ToolName =
  | 'session.search'
  | 'session.rename'
  | 'channel.send'
  | 'read_file'
  | 'search_files'
  | 'write_file'
  | 'patch'
  | 'web_search'
  | 'web_extract'
  | 'skills_list'
  | 'skill_view'
  | 'todo'
  | 'memory'
  | 'clarify'
  | 'vision_analyze';

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
  /** Enablement grouping (M17a): e.g. `session`, `channel`, `mcp`, `web`. */
  readonly toolset: string;
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

export interface ReadFileArgs {
  /** Path relative to the workspace root (or absolute, if inside it). */
  readonly path: string;
  /** Optional cap; the server also enforces its own maximum. */
  readonly maxBytes?: number;
}

export interface SearchFilesArgs {
  /** Regex (or literal) to search for. */
  readonly query: string;
  /** Directory to search, relative to the workspace root. Defaults to '.'. */
  readonly path?: string;
  readonly maxResults?: number;
}

export interface WriteFileArgs {
  /** Path relative to the workspace root (or absolute, if inside it). */
  readonly path: string;
  /** Full UTF-8 content to write (bounded). */
  readonly content: string;
}

export interface PatchArgs {
  /** Path relative to the workspace root (or absolute, if inside it). */
  readonly path: string;
  /** Exact text to find (must be unique unless replaceAll). */
  readonly oldString: string;
  /** Replacement text. */
  readonly newString: string;
  readonly replaceAll?: boolean;
}

export interface WebSearchArgs {
  readonly query: string;
  readonly maxResults?: number;
}

export interface WebExtractArgs {
  /** The page URL to fetch and extract text from. */
  readonly url: string;
  /** Optional cap; the server also enforces its own maximum. */
  readonly maxBytes?: number;
}

export interface SkillViewArgs {
  /** The skill name (directory name / frontmatter name). */
  readonly name: string;
}

export type TodoArgs =
  | { readonly action: 'list' }
  | { readonly action: 'clear' }
  | { readonly action: 'add'; readonly text: string }
  | { readonly action: 'complete'; readonly id: string }
  | { readonly action: 'remove'; readonly id: string };

export interface ClarifyArgs {
  /** The question to put to the user. */
  readonly question: string;
  /** Optional structured choices (2–4). Absent = free-form. */
  readonly options?: string[];
  /** Optional answer deadline, in milliseconds from creation. */
  readonly ttlMs?: number;
}

export interface VisionAnalyzeArgs {
  /** Workspace-relative image path. Exactly one of path/url. */
  readonly path?: string;
  /** http(s) image URL. Exactly one of path/url. */
  readonly url?: string;
  /** Optional instruction; defaults to a describe prompt. */
  readonly prompt?: string;
}

export type MemoryBeliefStatus =
  'candidate' | 'active' | 'contradicted' | 'retired';

export interface MemoryArgs {
  /**
   * Which memory layer to inspect: `beliefs` (epistemic claims, direct),
   * `recall` (ranked multi-surface retrieval, needs a query), `persona`
   * (curated identity / user model / relationship), `candidates` (raw
   * extracted candidates).
   */
  readonly layer: 'beliefs' | 'persona' | 'candidates' | 'recall';
  readonly query?: string;
  /** Beliefs only. */
  readonly status?: MemoryBeliefStatus;
  readonly limit?: number;
}

export type ValidatedToolArgs =
  | SessionSearchArgs
  | SessionRenameArgs
  | ChannelSendArgs
  | ReadFileArgs
  | SearchFilesArgs
  | WriteFileArgs
  | PatchArgs
  | WebSearchArgs
  | WebExtractArgs
  | SkillViewArgs
  | TodoArgs
  | MemoryArgs
  | ClarifyArgs
  | VisionAnalyzeArgs;

export type ValidatedToolRequest = {
  readonly version: 1;
  readonly sessionId: string;
} & (
  | { readonly name: 'session.search'; readonly args: SessionSearchArgs }
  | { readonly name: 'session.rename'; readonly args: SessionRenameArgs }
  | { readonly name: 'channel.send'; readonly args: ChannelSendArgs }
  | { readonly name: 'read_file'; readonly args: ReadFileArgs }
  | { readonly name: 'search_files'; readonly args: SearchFilesArgs }
  | { readonly name: 'write_file'; readonly args: WriteFileArgs }
  | { readonly name: 'patch'; readonly args: PatchArgs }
  | { readonly name: 'web_search'; readonly args: WebSearchArgs }
  | { readonly name: 'web_extract'; readonly args: WebExtractArgs }
  | { readonly name: 'skills_list'; readonly args: Record<string, never> }
  | { readonly name: 'skill_view'; readonly args: SkillViewArgs }
  | { readonly name: 'todo'; readonly args: TodoArgs }
  | { readonly name: 'memory'; readonly args: MemoryArgs }
  | { readonly name: 'clarify'; readonly args: ClarifyArgs }
  | { readonly name: 'vision_analyze'; readonly args: VisionAnalyzeArgs }
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
const MAX_PATH_LENGTH = 500;
const MAX_READ_BYTES = 256 * 1024;
const MAX_CONTENT_LENGTH = 256 * 1024;
const MIN_SEARCH_RESULTS = 1;
const MAX_SEARCH_RESULTS = 50;
const DEFAULT_SEARCH_RESULTS = 20;
const MAX_WEB_RESULTS = 10;
const DEFAULT_WEB_RESULTS = 5;
const MIN_MEMORY_LIMIT = 1;
const MAX_MEMORY_LIMIT = 50;
const DEFAULT_MEMORY_LIMIT = 20;
const MAX_QUESTION_LENGTH = 500;
const MIN_CLARIFY_OPTIONS = 2;
const MAX_CLARIFY_OPTIONS = 4;
const MAX_OPTION_LENGTH = 200;
const MIN_CLARIFY_TTL_MS = 1000;
const MAX_CLARIFY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_URL_LENGTH = 2000;
const MAX_EXTRACT_BYTES = 256 * 1024;

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

const READ_FILE_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: {
      type: 'string',
      pattern: NONBLANK_PATTERN,
      minLength: 1,
      maxLength: MAX_PATH_LENGTH,
    },
    maxBytes: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_READ_BYTES,
    },
  },
} as const);

const SEARCH_FILES_SCHEMA = deepFreeze({
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
    path: {
      type: 'string',
      pattern: NONBLANK_PATTERN,
      minLength: 1,
      maxLength: MAX_PATH_LENGTH,
    },
    maxResults: {
      type: 'integer',
      minimum: MIN_SEARCH_RESULTS,
      maximum: MAX_SEARCH_RESULTS,
      default: DEFAULT_SEARCH_RESULTS,
    },
  },
} as const);

const WRITE_FILE_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['path', 'content'],
  properties: {
    path: {
      type: 'string',
      pattern: NONBLANK_PATTERN,
      minLength: 1,
      maxLength: MAX_PATH_LENGTH,
    },
    content: { type: 'string', maxLength: MAX_CONTENT_LENGTH },
  },
} as const);

const PATCH_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['path', 'oldString', 'newString'],
  properties: {
    path: {
      type: 'string',
      pattern: NONBLANK_PATTERN,
      minLength: 1,
      maxLength: MAX_PATH_LENGTH,
    },
    oldString: { type: 'string', minLength: 1, maxLength: MAX_CONTENT_LENGTH },
    newString: { type: 'string', maxLength: MAX_CONTENT_LENGTH },
    replaceAll: { type: 'boolean', default: false },
  },
} as const);

const WEB_SEARCH_SCHEMA = deepFreeze({
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
    maxResults: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_WEB_RESULTS,
      default: DEFAULT_WEB_RESULTS,
    },
  },
} as const);

const WEB_EXTRACT_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['url'],
  properties: {
    url: {
      type: 'string',
      pattern: NONBLANK_PATTERN,
      minLength: 1,
      maxLength: MAX_URL_LENGTH,
    },
    maxBytes: { type: 'integer', minimum: 1, maximum: MAX_EXTRACT_BYTES },
  },
} as const);

const SKILLS_LIST_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {},
} as const);

const SKILL_VIEW_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: {
      type: 'string',
      pattern: NONBLANK_PATTERN,
      minLength: 1,
      maxLength: MAX_ID_LENGTH,
    },
  },
} as const);

const TODO_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: {
      type: 'string',
      enum: ['list', 'add', 'complete', 'remove', 'clear'],
    },
    text: {
      type: 'string',
      pattern: NONBLANK_PATTERN,
      minLength: 1,
      maxLength: MAX_BODY_LENGTH,
    },
    id: {
      type: 'string',
      pattern: NONBLANK_PATTERN,
      minLength: 1,
      maxLength: MAX_ID_LENGTH,
    },
  },
} as const);

const MEMORY_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['layer'],
  properties: {
    layer: {
      type: 'string',
      enum: ['beliefs', 'persona', 'candidates', 'recall'],
    },
    query: {
      type: 'string',
      pattern: NONBLANK_PATTERN,
      minLength: 1,
      maxLength: MAX_QUERY_LENGTH,
    },
    status: {
      type: 'string',
      enum: ['candidate', 'active', 'contradicted', 'retired'],
    },
    limit: {
      type: 'integer',
      minimum: MIN_MEMORY_LIMIT,
      maximum: MAX_MEMORY_LIMIT,
      default: DEFAULT_MEMORY_LIMIT,
    },
  },
} as const);

const CLARIFY_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['question'],
  properties: {
    question: {
      type: 'string',
      pattern: NONBLANK_PATTERN,
      minLength: 1,
      maxLength: MAX_QUESTION_LENGTH,
    },
    options: {
      type: 'array',
      minItems: MIN_CLARIFY_OPTIONS,
      maxItems: MAX_CLARIFY_OPTIONS,
      items: {
        type: 'string',
        pattern: NONBLANK_PATTERN,
        minLength: 1,
        maxLength: MAX_OPTION_LENGTH,
      },
    },
    ttlMs: {
      type: 'integer',
      minimum: MIN_CLARIFY_TTL_MS,
      maximum: MAX_CLARIFY_TTL_MS,
    },
  },
} as const);

const VISION_ANALYZE_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {
    path: {
      type: 'string',
      pattern: NONBLANK_PATTERN,
      minLength: 1,
      maxLength: MAX_PATH_LENGTH,
    },
    url: {
      type: 'string',
      pattern: NONBLANK_PATTERN,
      minLength: 1,
      maxLength: MAX_URL_LENGTH,
    },
    prompt: {
      type: 'string',
      pattern: NONBLANK_PATTERN,
      minLength: 1,
      maxLength: MAX_QUESTION_LENGTH,
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
    toolset: 'session',
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
    toolset: 'session',
    argsSchema: RENAME_SCHEMA,
  }),
  Object.freeze({
    name: 'channel.send',
    version: 1,
    description:
      'Send a message on a configured channel (Discord or email) to the ' +
      'operator, or to an allowlisted channel or user. Requires approval.',
    approval: 'required',
    toolset: 'channel',
    argsSchema: CHANNEL_SEND_SCHEMA,
  }),
  Object.freeze({
    name: 'read_file',
    version: 1,
    description:
      'Read a UTF-8 file from the workspace. Returns bounded content.',
    approval: 'none',
    toolset: 'files',
    argsSchema: READ_FILE_SCHEMA,
  }),
  Object.freeze({
    name: 'search_files',
    version: 1,
    description:
      'Search file contents under the workspace for a pattern. Returns ' +
      'matching path:line pairs.',
    approval: 'none',
    toolset: 'files',
    argsSchema: SEARCH_FILES_SCHEMA,
  }),
  Object.freeze({
    name: 'write_file',
    version: 1,
    description:
      'Write (or overwrite) a UTF-8 file in the workspace. Creates parent ' +
      'directories as needed.',
    approval: 'none',
    toolset: 'files',
    argsSchema: WRITE_FILE_SCHEMA,
  }),
  Object.freeze({
    name: 'patch',
    version: 1,
    description:
      'Replace an exact string in a workspace file. Fails if the string is ' +
      'absent, or ambiguous unless replaceAll is set.',
    approval: 'none',
    toolset: 'files',
    argsSchema: PATCH_SCHEMA,
  }),
  Object.freeze({
    name: 'web_search',
    version: 1,
    description:
      'Search the web. Returns titles, URLs, and snippets. Use web_extract ' +
      'to read a result page.',
    approval: 'none',
    toolset: 'web',
    argsSchema: WEB_SEARCH_SCHEMA,
  }),
  Object.freeze({
    name: 'web_extract',
    version: 1,
    description:
      'Fetch a web page and return its readable text (bounded). Use after ' +
      'web_search to read a result.',
    approval: 'none',
    toolset: 'web',
    argsSchema: WEB_EXTRACT_SCHEMA,
  }),
  Object.freeze({
    name: 'skills_list',
    version: 1,
    description: 'List the available skills (name, description, version).',
    approval: 'none',
    toolset: 'skills',
    argsSchema: SKILLS_LIST_SCHEMA,
  }),
  Object.freeze({
    name: 'skill_view',
    version: 1,
    description:
      'Read a skill’s full instructions by name. Use skills_list to discover ' +
      'names.',
    approval: 'none',
    toolset: 'skills',
    argsSchema: SKILL_VIEW_SCHEMA,
  }),
  Object.freeze({
    name: 'todo',
    version: 1,
    description:
      'Manage a todo list for the current session: list, add, complete, ' +
      'remove, or clear items.',
    approval: 'none',
    toolset: 'todo',
    argsSchema: TODO_SCHEMA,
  }),
  Object.freeze({
    name: 'memory',
    version: 1,
    description:
      'Inspect memory: beliefs (epistemic claims), recall (ranked retrieval ' +
      'across lexical/semantic/associative), persona, or raw candidates.',
    approval: 'none',
    toolset: 'memory',
    argsSchema: MEMORY_SCHEMA,
  }),
  Object.freeze({
    name: 'clarify',
    version: 1,
    description:
      'Ask the user a clarifying question and wait for the answer. Optionally ' +
      'offer up to 4 choices; an optional ttlMs bounds the wait.',
    approval: 'none',
    toolset: 'agent',
    argsSchema: CLARIFY_SCHEMA,
  }),
  Object.freeze({
    name: 'vision_analyze',
    version: 1,
    description:
      'Analyze an image with the vision model and return a text description. ' +
      'Provide a workspace path or an http(s) URL.',
    approval: 'none',
    toolset: 'vision',
    argsSchema: VISION_ANALYZE_SCHEMA,
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

function validateReadFileArgs(
  args: Record<string, unknown>,
): ParseResult<ReadFileArgs> {
  const unknownField = rejectUnknownFields(args, ['path', 'maxBytes']);
  if (unknownField !== undefined) {
    return { ok: false, message: unknownField };
  }
  const path = validText(ownValue(args, 'path'), 'path', MAX_PATH_LENGTH);
  if (!path.ok) {
    return path;
  }
  let maxBytes: number | undefined;
  if (Object.hasOwn(args, 'maxBytes')) {
    const value = ownValue(args, 'maxBytes');
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > MAX_READ_BYTES
    ) {
      return {
        ok: false,
        message: `maxBytes must be an integer between 1 and ${MAX_READ_BYTES}`,
      };
    }
    maxBytes = value;
  }
  return {
    ok: true,
    value: Object.freeze({
      path: path.value,
      ...(maxBytes !== undefined ? { maxBytes } : {}),
    }),
  };
}

function validateSearchFilesArgs(
  args: Record<string, unknown>,
): ParseResult<SearchFilesArgs> {
  const unknownField = rejectUnknownFields(args, [
    'query',
    'path',
    'maxResults',
  ]);
  if (unknownField !== undefined) {
    return { ok: false, message: unknownField };
  }
  const query = validText(ownValue(args, 'query'), 'query', MAX_QUERY_LENGTH);
  if (!query.ok) {
    return query;
  }
  let path: string | undefined;
  if (Object.hasOwn(args, 'path')) {
    const parsed = validText(ownValue(args, 'path'), 'path', MAX_PATH_LENGTH);
    if (!parsed.ok) {
      return parsed;
    }
    path = parsed.value;
  }
  let maxResults: number | undefined;
  if (Object.hasOwn(args, 'maxResults')) {
    const value = ownValue(args, 'maxResults');
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < MIN_SEARCH_RESULTS ||
      value > MAX_SEARCH_RESULTS
    ) {
      return {
        ok: false,
        message: `maxResults must be an integer between ${MIN_SEARCH_RESULTS} and ${MAX_SEARCH_RESULTS}`,
      };
    }
    maxResults = value;
  }
  return {
    ok: true,
    value: Object.freeze({
      query: query.value,
      ...(path !== undefined ? { path } : {}),
      ...(maxResults !== undefined ? { maxResults } : {}),
    }),
  };
}

function validateWriteFileArgs(
  args: Record<string, unknown>,
): ParseResult<WriteFileArgs> {
  const unknownField = rejectUnknownFields(args, ['path', 'content']);
  if (unknownField !== undefined) {
    return { ok: false, message: unknownField };
  }
  const path = validText(ownValue(args, 'path'), 'path', MAX_PATH_LENGTH);
  if (!path.ok) {
    return path;
  }
  const content = ownValue(args, 'content');
  if (typeof content !== 'string') {
    return { ok: false, message: 'content must be a string' };
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return {
      ok: false,
      message: `content must be at most ${MAX_CONTENT_LENGTH} characters`,
    };
  }
  return { ok: true, value: Object.freeze({ path: path.value, content }) };
}

function validatePatchArgs(
  args: Record<string, unknown>,
): ParseResult<PatchArgs> {
  const unknownField = rejectUnknownFields(args, [
    'path',
    'oldString',
    'newString',
    'replaceAll',
  ]);
  if (unknownField !== undefined) {
    return { ok: false, message: unknownField };
  }
  const path = validText(ownValue(args, 'path'), 'path', MAX_PATH_LENGTH);
  if (!path.ok) {
    return path;
  }
  const oldString = ownValue(args, 'oldString');
  if (typeof oldString !== 'string' || oldString.length === 0) {
    return { ok: false, message: 'oldString must be a non-empty string' };
  }
  if (oldString.length > MAX_CONTENT_LENGTH) {
    return {
      ok: false,
      message: `oldString must be at most ${MAX_CONTENT_LENGTH} characters`,
    };
  }
  const newString = ownValue(args, 'newString');
  if (typeof newString !== 'string') {
    return { ok: false, message: 'newString must be a string' };
  }
  if (newString.length > MAX_CONTENT_LENGTH) {
    return {
      ok: false,
      message: `newString must be at most ${MAX_CONTENT_LENGTH} characters`,
    };
  }
  let replaceAll: boolean | undefined;
  if (Object.hasOwn(args, 'replaceAll')) {
    const value = ownValue(args, 'replaceAll');
    if (typeof value !== 'boolean') {
      return { ok: false, message: 'replaceAll must be a boolean' };
    }
    replaceAll = value;
  }
  return {
    ok: true,
    value: Object.freeze({
      path: path.value,
      oldString,
      newString,
      ...(replaceAll !== undefined ? { replaceAll } : {}),
    }),
  };
}

function validateWebSearchArgs(
  args: Record<string, unknown>,
): ParseResult<WebSearchArgs> {
  const unknownField = rejectUnknownFields(args, ['query', 'maxResults']);
  if (unknownField !== undefined) {
    return { ok: false, message: unknownField };
  }
  const query = validText(ownValue(args, 'query'), 'query', MAX_QUERY_LENGTH);
  if (!query.ok) {
    return query;
  }
  let maxResults: number | undefined;
  if (Object.hasOwn(args, 'maxResults')) {
    const value = ownValue(args, 'maxResults');
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > MAX_WEB_RESULTS
    ) {
      return {
        ok: false,
        message: `maxResults must be an integer between 1 and ${MAX_WEB_RESULTS}`,
      };
    }
    maxResults = value;
  }
  return {
    ok: true,
    value: Object.freeze({
      query: query.value,
      ...(maxResults !== undefined ? { maxResults } : {}),
    }),
  };
}

function validateWebExtractArgs(
  args: Record<string, unknown>,
): ParseResult<WebExtractArgs> {
  const unknownField = rejectUnknownFields(args, ['url', 'maxBytes']);
  if (unknownField !== undefined) {
    return { ok: false, message: unknownField };
  }
  const url = validText(ownValue(args, 'url'), 'url', MAX_URL_LENGTH);
  if (!url.ok) {
    return url;
  }
  let maxBytes: number | undefined;
  if (Object.hasOwn(args, 'maxBytes')) {
    const value = ownValue(args, 'maxBytes');
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > MAX_EXTRACT_BYTES
    ) {
      return {
        ok: false,
        message: `maxBytes must be an integer between 1 and ${MAX_EXTRACT_BYTES}`,
      };
    }
    maxBytes = value;
  }
  return {
    ok: true,
    value: Object.freeze({
      url: url.value,
      ...(maxBytes !== undefined ? { maxBytes } : {}),
    }),
  };
}

function validateSkillsListArgs(
  args: Record<string, unknown>,
): ParseResult<Record<string, never>> {
  const unknownField = rejectUnknownFields(args, []);
  if (unknownField !== undefined) {
    return { ok: false, message: unknownField };
  }
  return { ok: true, value: Object.freeze({}) };
}

function validateSkillViewArgs(
  args: Record<string, unknown>,
): ParseResult<SkillViewArgs> {
  const unknownField = rejectUnknownFields(args, ['name']);
  if (unknownField !== undefined) {
    return { ok: false, message: unknownField };
  }
  const name = validText(ownValue(args, 'name'), 'name', MAX_ID_LENGTH);
  if (!name.ok) {
    return name;
  }
  return { ok: true, value: Object.freeze({ name: name.value }) };
}

function validateTodoArgs(
  args: Record<string, unknown>,
): ParseResult<TodoArgs> {
  const unknownField = rejectUnknownFields(args, ['action', 'text', 'id']);
  if (unknownField !== undefined) {
    return { ok: false, message: unknownField };
  }
  const action = ownValue(args, 'action');
  if (action === 'list' || action === 'clear') {
    return { ok: true, value: Object.freeze({ action }) };
  }
  if (action === 'add') {
    const text = validText(ownValue(args, 'text'), 'text', MAX_BODY_LENGTH);
    if (!text.ok) {
      return text;
    }
    return {
      ok: true,
      value: Object.freeze({ action: 'add', text: text.value }),
    };
  }
  if (action === 'complete' || action === 'remove') {
    const id = validText(ownValue(args, 'id'), 'id', MAX_ID_LENGTH);
    if (!id.ok) {
      return id;
    }
    return { ok: true, value: Object.freeze({ action, id: id.value }) };
  }
  return {
    ok: false,
    message: 'action must be "list", "add", "complete", "remove", or "clear"',
  };
}

function validateMemoryArgs(
  args: Record<string, unknown>,
): ParseResult<MemoryArgs> {
  const unknownField = rejectUnknownFields(args, [
    'layer',
    'query',
    'status',
    'limit',
  ]);
  if (unknownField !== undefined) {
    return { ok: false, message: unknownField };
  }
  const layer = ownValue(args, 'layer');
  if (
    layer !== 'beliefs' &&
    layer !== 'persona' &&
    layer !== 'candidates' &&
    layer !== 'recall'
  ) {
    return {
      ok: false,
      message: 'layer must be "beliefs", "persona", "candidates", or "recall"',
    };
  }
  let query: string | undefined;
  if (Object.hasOwn(args, 'query')) {
    const parsed = validText(
      ownValue(args, 'query'),
      'query',
      MAX_QUERY_LENGTH,
    );
    if (!parsed.ok) {
      return parsed;
    }
    query = parsed.value;
  }
  if (layer === 'recall' && query === undefined) {
    return { ok: false, message: 'query is required for the recall layer' };
  }
  let status: MemoryBeliefStatus | undefined;
  if (Object.hasOwn(args, 'status')) {
    if (layer !== 'beliefs') {
      return {
        ok: false,
        message: 'status applies to the beliefs layer only',
      };
    }
    const value = ownValue(args, 'status');
    if (
      value !== 'candidate' &&
      value !== 'active' &&
      value !== 'contradicted' &&
      value !== 'retired'
    ) {
      return {
        ok: false,
        message:
          'status must be "candidate", "active", "contradicted", or "retired"',
      };
    }
    status = value;
  }
  let limit: number | undefined;
  if (Object.hasOwn(args, 'limit')) {
    const value = ownValue(args, 'limit');
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < MIN_MEMORY_LIMIT ||
      value > MAX_MEMORY_LIMIT
    ) {
      return {
        ok: false,
        message: `limit must be an integer between ${MIN_MEMORY_LIMIT} and ${MAX_MEMORY_LIMIT}`,
      };
    }
    limit = value;
  }
  return {
    ok: true,
    value: Object.freeze({
      layer,
      ...(query !== undefined ? { query } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(limit !== undefined ? { limit } : {}),
    }),
  };
}

function validateClarifyArgs(
  args: Record<string, unknown>,
): ParseResult<ClarifyArgs> {
  const unknownField = rejectUnknownFields(args, [
    'question',
    'options',
    'ttlMs',
  ]);
  if (unknownField !== undefined) {
    return { ok: false, message: unknownField };
  }
  const question = validText(
    ownValue(args, 'question'),
    'question',
    MAX_QUESTION_LENGTH,
  );
  if (!question.ok) {
    return question;
  }
  let options: string[] | undefined;
  if (Object.hasOwn(args, 'options')) {
    const raw = ownValue(args, 'options');
    if (!Array.isArray(raw)) {
      return { ok: false, message: 'options must be an array of strings' };
    }
    if (raw.length < MIN_CLARIFY_OPTIONS || raw.length > MAX_CLARIFY_OPTIONS) {
      return {
        ok: false,
        message: `options must have between ${MIN_CLARIFY_OPTIONS} and ${MAX_CLARIFY_OPTIONS} items`,
      };
    }
    const cleaned: string[] = [];
    for (const item of raw) {
      const parsed = validText(item, 'options[]', MAX_OPTION_LENGTH);
      if (!parsed.ok) {
        return parsed;
      }
      cleaned.push(parsed.value);
    }
    options = cleaned;
  }
  let ttlMs: number | undefined;
  if (Object.hasOwn(args, 'ttlMs')) {
    const value = ownValue(args, 'ttlMs');
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < MIN_CLARIFY_TTL_MS ||
      value > MAX_CLARIFY_TTL_MS
    ) {
      return {
        ok: false,
        message: `ttlMs must be an integer between ${MIN_CLARIFY_TTL_MS} and ${MAX_CLARIFY_TTL_MS}`,
      };
    }
    ttlMs = value;
  }
  return {
    ok: true,
    value: Object.freeze({
      question: question.value,
      ...(options !== undefined ? { options } : {}),
      ...(ttlMs !== undefined ? { ttlMs } : {}),
    }),
  };
}

function validateVisionAnalyzeArgs(
  args: Record<string, unknown>,
): ParseResult<VisionAnalyzeArgs> {
  const unknownField = rejectUnknownFields(args, ['path', 'url', 'prompt']);
  if (unknownField !== undefined) {
    return { ok: false, message: unknownField };
  }
  const hasPath = Object.hasOwn(args, 'path');
  const hasUrl = Object.hasOwn(args, 'url');
  if (hasPath === hasUrl) {
    return { ok: false, message: 'provide exactly one of "path" or "url"' };
  }
  let path: string | undefined;
  if (hasPath) {
    const parsed = validText(ownValue(args, 'path'), 'path', MAX_PATH_LENGTH);
    if (!parsed.ok) return parsed;
    path = parsed.value;
  }
  let url: string | undefined;
  if (hasUrl) {
    const parsed = validText(ownValue(args, 'url'), 'url', MAX_URL_LENGTH);
    if (!parsed.ok) return parsed;
    url = parsed.value;
  }
  let prompt: string | undefined;
  if (Object.hasOwn(args, 'prompt')) {
    const parsed = validText(
      ownValue(args, 'prompt'),
      'prompt',
      MAX_QUESTION_LENGTH,
    );
    if (!parsed.ok) return parsed;
    prompt = parsed.value;
  }
  return {
    ok: true,
    value: Object.freeze({
      ...(path !== undefined ? { path } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(prompt !== undefined ? { prompt } : {}),
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
        toolset: 'mcp',
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
      toolset: 'mcp',
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
    if (descriptor.name === 'read_file') {
      const result = validateReadFileArgs(args);
      if (!result.ok) {
        return fail('invalid_args', result.message);
      }
      return {
        ok: true,
        request: Object.freeze({
          name: 'read_file',
          ...base,
          args: result.value,
        }),
      };
    }
    if (descriptor.name === 'search_files') {
      const result = validateSearchFilesArgs(args);
      if (!result.ok) {
        return fail('invalid_args', result.message);
      }
      return {
        ok: true,
        request: Object.freeze({
          name: 'search_files',
          ...base,
          args: result.value,
        }),
      };
    }
    if (descriptor.name === 'write_file') {
      const result = validateWriteFileArgs(args);
      if (!result.ok) {
        return fail('invalid_args', result.message);
      }
      return {
        ok: true,
        request: Object.freeze({
          name: 'write_file',
          ...base,
          args: result.value,
        }),
      };
    }
    if (descriptor.name === 'patch') {
      const result = validatePatchArgs(args);
      if (!result.ok) {
        return fail('invalid_args', result.message);
      }
      return {
        ok: true,
        request: Object.freeze({
          name: 'patch',
          ...base,
          args: result.value,
        }),
      };
    }
    if (descriptor.name === 'web_search') {
      const result = validateWebSearchArgs(args);
      if (!result.ok) {
        return fail('invalid_args', result.message);
      }
      return {
        ok: true,
        request: Object.freeze({
          name: 'web_search',
          ...base,
          args: result.value,
        }),
      };
    }
    if (descriptor.name === 'web_extract') {
      const result = validateWebExtractArgs(args);
      if (!result.ok) {
        return fail('invalid_args', result.message);
      }
      return {
        ok: true,
        request: Object.freeze({
          name: 'web_extract',
          ...base,
          args: result.value,
        }),
      };
    }
    if (descriptor.name === 'skills_list') {
      const result = validateSkillsListArgs(args);
      if (!result.ok) {
        return fail('invalid_args', result.message);
      }
      return {
        ok: true,
        request: Object.freeze({
          name: 'skills_list',
          ...base,
          args: result.value,
        }),
      };
    }
    if (descriptor.name === 'skill_view') {
      const result = validateSkillViewArgs(args);
      if (!result.ok) {
        return fail('invalid_args', result.message);
      }
      return {
        ok: true,
        request: Object.freeze({
          name: 'skill_view',
          ...base,
          args: result.value,
        }),
      };
    }
    if (descriptor.name === 'todo') {
      const result = validateTodoArgs(args);
      if (!result.ok) {
        return fail('invalid_args', result.message);
      }
      return {
        ok: true,
        request: Object.freeze({
          name: 'todo',
          ...base,
          args: result.value,
        }),
      };
    }
    if (descriptor.name === 'memory') {
      const result = validateMemoryArgs(args);
      if (!result.ok) {
        return fail('invalid_args', result.message);
      }
      return {
        ok: true,
        request: Object.freeze({
          name: 'memory',
          ...base,
          args: result.value,
        }),
      };
    }
    if (descriptor.name === 'clarify') {
      const result = validateClarifyArgs(args);
      if (!result.ok) {
        return fail('invalid_args', result.message);
      }
      return {
        ok: true,
        request: Object.freeze({
          name: 'clarify',
          ...base,
          args: result.value,
        }),
      };
    }
    if (descriptor.name === 'vision_analyze') {
      const result = validateVisionAnalyzeArgs(args);
      if (!result.ok) {
        return fail('invalid_args', result.message);
      }
      return {
        ok: true,
        request: Object.freeze({
          name: 'vision_analyze',
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
